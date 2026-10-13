import { ToolError } from './http.js';

/** Small arithmetic parser, never eval/Function or a shell. Exponentiation is right associative. */
export function calculate(source: string): number {
  const expression = source.replace(/×/g, '*').replace(/[÷]/g, '/').replace(/−/g, '-').replace(/π/g, 'pi');
  const tokens = expression.match(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[a-z]+|\*\*|[+\-*/^()%]/gi) ?? [];
  if (!tokens.length || tokens.length > 256 || tokens.join('') !== expression.replace(/\s+/g, '')) throw new ToolError('invalid_expression', '只支持数字、括号、加减乘除、乘方、百分数及 sqrt/abs/round/floor/ceil/sin/cos/log 函数。');
  let index = 0;
  let depth = 0;
  const functions: Record<string, (n: number) => number> = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, log: Math.log10, ln: Math.log };
  const atom = (): number => {
    if (++depth > 32) throw new ToolError('expression_too_complex', '表达式嵌套过深。');
    let value: number;
    const token = tokens[index++];
    if (token === '(') { value = sum(); if (tokens[index++] !== ')') throw new ToolError('invalid_expression', '括号不匹配。'); }
    else if (token && functions[token.toLowerCase()]) {
      if (tokens[index++] !== '(') throw new ToolError('invalid_expression', '函数参数需要括号。');
      value = functions[token.toLowerCase()]!(sum());
      if (tokens[index++] !== ')') throw new ToolError('invalid_expression', '括号不匹配。');
    } else if (token === 'pi') value = Math.PI;
    else if (token === 'e') value = Math.E;
    else if (token && /^(?:\d|\.)/.test(token)) value = Number(token);
    else throw new ToolError('invalid_expression', '算式格式不正确。');
    while (tokens[index] === '%') { index++; value /= 100; }
    depth--;
    return value;
  };
  const power = (): number => {
    const left = atom();
    if (tokens[index] === '^' || tokens[index] === '**') { index++; return left ** unary(); }
    return left;
  };
  const unary = (): number => {
    if (tokens[index] === '+') { index++; return unary(); }
    if (tokens[index] === '-') { index++; return -unary(); }
    return power();
  };
  const product = (): number => {
    let value = unary();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++]; const right = unary();
      if (operator === '/' && right === 0) throw new ToolError('division_by_zero', '不能除以零。');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++]; const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const result = sum();
  if (index !== tokens.length || !Number.isFinite(result)) throw new ToolError('invalid_result', '表达式无法得到有限实数结果。');
  return Number(result.toPrecision(15));
}

type Unit = { dimension: string; scale: number; offset?: number };
const units: Record<string, Unit> = {};
function unit(names: string[], dimension: string, scale: number, offset = 0) {
  names.forEach((name) => { units[name] = { dimension, scale, offset }; });
}
unit(['m', '米'], 'length', 1); unit(['km', '千米', '公里'], 'length', 1000); unit(['cm', '厘米'], 'length', 0.01); unit(['mm', '毫米'], 'length', 0.001);
unit(['in', 'inch', '英寸'], 'length', 0.0254); unit(['ft', 'feet', '英尺'], 'length', 0.3048); unit(['mile', 'mi', '英里'], 'length', 1609.344);
unit(['kg', '千克', '公斤'], 'mass', 1); unit(['g', '克'], 'mass', 0.001); unit(['lb', '磅'], 'mass', 0.45359237); unit(['斤'], 'mass', 0.5); unit(['oz', '盎司'], 'mass', 0.028349523125);
unit(['c', '°c', '摄氏度'], 'temperature', 1, 273.15); unit(['f', '°f', '华氏度'], 'temperature', 5 / 9, 255.3722222222222); unit(['k', '开尔文'], 'temperature', 1);
unit(['l', '升'], 'volume', 1); unit(['ml', '毫升'], 'volume', 0.001); unit(['us gallon', '美制加仑'], 'volume', 3.785411784);
unit(['m2', '平方米'], 'area', 1); unit(['km2', '平方公里'], 'area', 1e6); unit(['亩'], 'area', 2000 / 3); unit(['ha', '公顷'], 'area', 1e4);
unit(['s', '秒'], 'duration', 1); unit(['min', '分钟'], 'duration', 60); unit(['h', '小时'], 'duration', 3600); unit(['day', '天'], 'duration', 86400);
unit(['m/s', '米/秒'], 'speed', 1); unit(['km/h', '公里/小时'], 'speed', 1 / 3.6); unit(['mph', '英里/小时'], 'speed', 0.44704);

export function convertUnit(value: number, from: string, to: string) {
  const source = units[from.toLowerCase().trim()]; const target = units[to.toLowerCase().trim()];
  if (!source || !target || source.dimension !== target.dimension) throw new ToolError('invalid_unit', '单位不支持或量纲不同。请用明确单位，例如 km/m、kg/斤、°C/°F、L/mL。');
  const base = value * source.scale + (source.offset ?? 0);
  if (source.dimension === 'temperature' && base < 0) throw new ToolError('invalid_temperature', '温度不能低于绝对零度。');
  const result = (base - (target.offset ?? 0)) / target.scale;
  if (!Number.isFinite(result)) throw new ToolError('invalid_result', '换算结果超出范围。');
  return { value, from, to, result: Number(result.toPrecision(15)) };
}

export function dateMath(date: string, days?: number, endDate?: string) {
  const parse = (value: string) => {
    const milliseconds = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) throw new ToolError('invalid_date', '日期必须是真实的 YYYY-MM-DD 公历日期。');
    return milliseconds;
  };
  const start = parse(date);
  if (endDate) return { startDate: date, endDate, days: (parse(endDate) - start) / 86_400_000, convention: '不含起始日，按公历日期计算，不包含农历/节假日规则。' };
  const result = new Date(start + (days ?? 0) * 86_400_000);
  return { startDate: date, days: days ?? 0, result: result.toISOString().slice(0, 10), weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'UTC' }).format(result) };
}
