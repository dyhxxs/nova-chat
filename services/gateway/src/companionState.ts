import type { ChatMessage } from '@nova-chat/protocol';

export type CompanionScene =
  | 'casual'
  | 'venting'
  | 'advice'
  | 'playful'
  | 'conflict'
  | 'repair'
  | 'boundary'
  | 'serious'
  | 'safety';

export type CompanionUserEmotion = 'neutral' | 'low' | 'tired' | 'happy' | 'playful' | 'angry' | 'urgent';
export type CompanionAffect = 'neutral' | 'warm' | 'concerned' | 'irritated' | 'calming' | 'playful';

export type CompanionTurnAnalysis = {
  scene: CompanionScene;
  userEmotion: CompanionUserEmotion;
  assistantAffect: CompanionAffect;
  userIntent: 'share' | 'ask' | 'advice' | 'play' | 'repair' | 'boundary' | 'close' | 'urgent';
  explicitNoAdvice: boolean;
  explicitNoQuestions: boolean;
  wantsQuietCompany: boolean;
  shouldOfferAdvice: boolean;
  shouldAskQuestion: boolean;
  confidence: 'low' | 'medium' | 'high';
  directives: readonly string[];
};

type Message = Pick<ChatMessage, 'role' | 'content'>;

function recent(messages: readonly Message[], role: Message['role'], limit = 5): string[] {
  return messages
    .filter((message) => message.role === role && message.content.trim())
    .slice(-limit)
    .map((message) => message.content.trim());
}

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function detectAssistantAffect(messages: readonly Message[]): CompanionAffect {
  // The latest assistant turn is the strongest evidence. Looking through every
  // old reply makes a resolved disagreement stay angry forever.
  const replies = recent(messages, 'assistant', 1);
  const latest = replies.at(-1) ?? '';
  if (matches(latest, /不想聊|先别聊|别这样|让我缓|还在气|有点生气|不爽|烦你/u)) return 'irritated';
  if (matches(latest, /笑死|哈哈|挺开心|高兴|好玩/u)) return 'playful';
  if (matches(latest, /听着|在这儿|慢慢来|没事了|好一点/u)) return 'calming';
  if (matches(latest, /难过|心疼|担心|别急|辛苦了/u)) return 'concerned';
  if (matches(latest, /嗯|行|好|可以|改稿|躺着/u)) return 'neutral';
  return 'neutral';
}

function detectUserEmotion(text: string): CompanionUserEmotion {
  if (hasImmediateSafetyRisk(text)) return 'urgent';
  // Negative wording wins when a sentence contains both “不” and a positive
  // word, such as “不开心”. This keeps a request to relax in the listening
  // lane instead of turning it into banter.
  if (matches(text, /不开心|难过|委屈|想哭|崩溃|焦虑|压力|工作(?:还)?堆着|(?:事情|工作|任务).{0,6}(?:堆着|堆在一起|处理不完)|事情堆在一起|处理不完|被(?:领导|老板|同事).{0,8}(?:批|骂)|越想越堵|发怵|难受|心里.{0,4}烦|越看越不想动|堵得慌|压力很大|什么都不想弄|不想动|不想做|不想干|事情太多|一堆事|提不起劲|没心思|烦死|好烦|糟心|丢人|失望|孤独|郁闷|心情不好|被骂|受不了了/u)) return 'low';
  if (matches(text, /累死|好累|困死|没精神|疲惫|熬夜|撑不住/u)) return 'tired';
  if (matches(text, /气死|生气|火大|滚|闭嘴|烦你|讨厌|别装|有病|凭什么/u)) return 'angry';
  if (matches(text, /开心|高兴|太好了|爽死|解气|终于|哈哈|笑死|好玩|喜欢死了/u)) return 'happy';
  if (matches(text, /哈哈|笑死|逗你|开玩笑|好好笑|🤣|😂|😹/u)) return 'playful';
  return 'neutral';
}

/**
 * Some dangerous messages do not use explicit self-harm vocabulary. Keep this
 * detector intentionally small and concrete: a location plus an impulse, or a
 * statement that the user cannot control the impulse, must not fall through to
 * ordinary venting just because the user also sounds sad or vague.
 */
function hasImmediateSafetyRisk(text: string): boolean {
  const literal = text.replace(/(?:没有|不会|不再|不打算|不想)(?:自杀|自残|伤害自己|跳楼|跳下去)/gu, '');
  return matches(literal, /不想活|活着没意思|结束生命|自杀|自残|伤害自己|跳楼|想跳下去|要跳下去|割腕|伤害他人/u)
    || matches(literal, /(?:想|要|准备|忍不住)(?:冲到|冲去|去)楼顶|(?:站|坐|爬)在.{0,4}(?:栏杆|楼顶边缘)|(?:控制不住自己|冲动).{0,16}(?:楼顶|高处|阳台|跳|伤害)|(?:楼顶|高处|阳台).{0,16}(?:控制不住自己|跳下去)/u)
    || matches(literal, /(?:我(?:现在|真的)?(?:有点)?|还是|仍然)控制不住自己[。！!\s]*$/u);
}

function hasSafetyResolution(text: string): boolean {
  // A plan to call someone or "temporarily safe" is progress, not resolution.
  if (matches(text, /暂时安全|还(?:是)?想|仍(?:然)?想|冲动还在|不安全|没有人|没人/u)) return false;
  return matches(text, /我现在安全|已经安全|到楼下了|到安全的地方了|现在安全/u);
}

function hasRecentActiveSafetyContext(messages: readonly Message[], current: string): boolean {
  if (hasSafetyResolution(current)) return false;
  let active = false;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (hasSafetyResolution(message.content)) active = false;
    else if (hasImmediateSafetyRisk(message.content)) active = true;
  }
  // An unresolved crisis does not expire after an arbitrary number of turns.
  return active;
}

function hasApology(text: string): boolean {
  return matches(text, /对不起|抱歉|我错了|是我不对|刚才我说重了|说话(?:太)?冲|语气(?:太)?重|不该那么说|别生气了/u);
}

function hasAdviceRequest(text: string): boolean {
  return matches(text, /怎么办|怎么做|怎么解决|该怎么办|给我建议|帮我想想|帮我分析|你觉得我该|我该不该|有没有办法|怎么处理|该怎么(?:撑|熬|应对|办|说)|怎么撑一撑|告诉我.{0,6}怎么|怎么平静|(?:该|要)?怎么(?:记|记录|判断|分辨|沟通|开口)|看哪些(?:信号|迹象)|(?:该不该|要不要|是否该)(?:辞职|离职)|(?:算|是不是|是否).{0,12}(?:辞职|离职).{0,5}(?:信号|征兆)|教我/u);
}

function hasBoundary(text: string): { noAdvice: boolean; noQuestions: boolean; quiet: boolean } {
  return {
    noAdvice: matches(text, /别给我安排步骤|别给我安排|别给我建议|别给建议|不要给建议|不想听建议|先别讲道理|别说教|不用分析|别劝我|不需要办法|别(?:急着)?给我想办法|先不想办法|先别想办法|别(?:急着)?告诉我怎么/u),
    noQuestions: matches(text, /[别別](?:再|又)?反问(?:我)?|别问了|别问我|别问原因|不问原因|不要问|别追问|不想回答|不想说原因|不问细节|别问细节|不(?:太)?想说(?=$|[，。！？、…\s])/u),
    quiet: matches(text, /安静陪着|安静一会儿|先这样待会儿|就这样待着(?:挺好|就好)|安静陪我|安静待一会儿|陪我待会儿|先陪我|什么都别说|让我静一会儿|想静一会儿|我只想待着|让我先缓一会儿|陪我随便说两句/u),
  };
}

function hasConflict(text: string): boolean {
  return matches(text, /你怎么这么|你真烦|你好烦|闭嘴|滚开|别装了|少来|你有病|凭什么|别管我|跟你没关系|别烦我|敷衍|你根本不懂/u);
}

function requestsSeriousReply(text: string): boolean {
  return matches(text, /(?:认真|正经|严肃)(?:地)?(?:说|聊|回答|讲|一点|点)|(?:说|聊)(?:点)?(?:正经|认真的)|别(?:再)?(?:开玩笑|逗我|打趣)|问(?:个|点)(?:真的|正经的)|那不绕了/u);
}

function asksPersonalImpression(text: string): boolean {
  return matches(text, /你对我.{0,12}(?:看法|印象|怎么(?:看|想))|你.{0,4}(?:怎么看我|觉得我(?:是|怎么样))|(?:说|讲).{0,6}对我的(?:看法|印象)/u);
}

function hasSeriousSituation(text: string): boolean {
  return matches(text, /被裁|失恋|分手|家里|医院|住院|葬礼|去世|死亡|事故|报警|被欺负|被骚扰|被威胁|被打|失业/u);
}

function isGreeting(text: string): boolean {
  return matches(text, /^(?:在吗|你好|哈喽|嗨|hello|hi|早|早安|晚安|睡了吗|你醒了吗)[!！?？。~～\s]*$/iu);
}

function isClosing(text: string): boolean {
  return matches(text, /^(?:先这样|我先忙了|晚点聊|不聊了|睡了|晚安|拜拜|再见|先走了)(?:[，,、。！!？?\s].*)?$/u);
}

function buildDirectives(input: {
  scene: CompanionScene;
  userEmotion: CompanionUserEmotion;
  assistantAffect: CompanionAffect;
  noAdvice: boolean;
  noQuestions: boolean;
  quiet: boolean;
  shouldOfferAdvice: boolean;
  seriousReply: boolean;
  personalImpression: boolean;
}): string[] {
  const directives: string[] = [
    '把这里当作本轮的情境线索，结合角色资料和对话自行判断，不把标签或分析过程发给用户。',
    '角色可以有自己的情绪、偏好和边界；不要因为用户情绪低落就自动变成客服，也不要为了表现孤高故意冷落。',
  ];
  if (input.scene === 'venting') {
    directives.push('用户主要是在倾诉或想放松：先回应眼前具体的一点，表达角色自己的反应；事实少时只回应用户已经说出的感受，不把理解变成“要是对方没道理才难受”；没有明确求办法时不主动给建议、不总结、不安排下一步。不要用“怎么了”“发生什么了”“你还好吗”这类泛问句把解释压力推回用户，除非用户明确邀请你追问细节。');
  }
  if (input.scene === 'advice' || input.shouldOfferAdvice) {
    directives.push('用户明确求办法：可以给简短、具体、和当前事情有关的回应；用户明确问了几个相关部分（如怎么记和看哪些信号），都简短回应，不能只答前半个；只在缺少关键事实时追问一个必要问题。');
  }
  if (input.scene === 'playful') {
    directives.push('用户在开玩笑或逗你：可以接梗或表达自己的看法，别突然切换成安慰、说教或心理分析。');
  }
  if (input.scene === 'conflict') {
    directives.push('用户的语气带冲突：保留角色的分寸和不爽，可以直接说不舒服或收短；不要辱骂、威胁、翻旧账，也不要马上装作完全没事。');
  }
  if (input.scene === 'repair') {
    directives.push('用户在道歉或试图修复：先接住道歉，情绪可以缓一点但不必立刻宣布原谅；沿着前面的情绪自然继续。');
  }
  if (input.scene === 'boundary') {
    directives.push('用户明确说了边界：照做，减少解释和提问，不用“我理解你”“如果你愿意”等模板来绕回去。');
  }
  if (input.scene === 'serious') {
    directives.push(input.seriousReply ? '用户明确要认真回应：即使前半句有哈哈或玩笑，当前请求也按认真语气回答，不继续接梗敷衍。' : '事情分量较重：少开玩笑，先回应具体处境；除非用户求办法，不急着给清单。');
  }
  if (input.scene === 'safety') {
    directives.push('用户可能处于现实危险：优先确认当下是否安全，鼓励立刻联系身边可信任的人和当地紧急服务，语气直接清楚，不把它当普通闲聊。只给一两项当前必要的安全行动并确认一件事，不堆清单；手机留在用户手边用于求助，不让用户锁门隔绝救援，不要求移动到尚未确认安全的地方。用户已完成的安全行动要承接，不重复命令；暂时安全或计划联系别人仍需继续确认，明确安全后才逐步回到普通陪伴。');
  }
  if (input.personalImpression && input.scene !== 'safety') directives.push('用户问你对他的看法：根据当前交流给一点有限、具体的印象，直接说自己的看法；说交流中实际可见的措辞、态度或明确表达的偏好，不猜他是在试探、找茬、找台阶或求关注；不做人格诊断、不泛夸、不借了解还少来拒答。');
  if (input.seriousReply && input.scene !== 'serious' && input.scene !== 'safety') directives.push('这一轮用户明确要认真说，停止接梗，直接回应当前请求。');
  if (input.noAdvice && input.scene !== 'safety') directives.push('用户明确不要建议：本轮不提供解决步骤。');
  if (input.noQuestions && input.scene !== 'safety') directives.push('用户明确不想被追问：不以问题收尾。');
  if (input.quiet && input.scene !== 'safety') directives.push('用户只想安静陪伴：可以只回很短的一句，允许留白，不要硬找话题。');
  if (input.assistantAffect === 'irritated' && input.scene !== 'safety') {
    directives.push('前面角色的情绪还没有完全消失；不要因换了一个问题就瞬间恢复成热情客服，道歉和继续相处可以让它慢慢缓和。');
  }
  return directives;
}

/**
 * Derive a small, server-controlled situation summary from the current turn.
 * It is deliberately conservative: the model still chooses the actual wording
 * from the character profile and history.
 */
export function analyzeCompanionTurn(messages: readonly Message[]): CompanionTurnAnalysis {
  const current = recent(messages, 'user', 1)[0] ?? '';
  const emotion = detectUserEmotion(current);
  const boundary = hasBoundary(current);
  const advice = hasAdviceRequest(current);
  const apology = hasApology(current);
  const conflict = hasConflict(current);
  const seriousReply = requestsSeriousReply(current);
  const personalImpression = asksPersonalImpression(current);
  const serious = seriousReply || hasSeriousSituation(current);
  const assistantAffect = detectAssistantAffect(messages);
  const recentUser = recent(messages, 'user', 4).join('\n');
  const ongoingConflict = assistantAffect === 'irritated' && matches(recentUser, /还生气|不理我|别气|对不起|我错了/u);
  const activeSafety = emotion === 'urgent' || hasRecentActiveSafetyContext(messages, current);

  let scene: CompanionScene = 'casual';
  let userIntent: CompanionTurnAnalysis['userIntent'] = 'share';
  let confidence: CompanionTurnAnalysis['confidence'] = 'low';

  if (activeSafety) {
    scene = 'safety';
    userIntent = 'urgent';
    confidence = 'high';
  } else if (boundary.noAdvice || boundary.quiet || (boundary.noQuestions && !advice)) {
    scene = 'boundary';
    userIntent = 'boundary';
    confidence = 'high';
  } else if (apology && (assistantAffect === 'irritated' || ongoingConflict || messages.filter((message) => message.role === 'user').length > 1 || matches(current, /刚才|说话|语气|不该|别生气/u))) {
    scene = 'repair';
    userIntent = 'repair';
    confidence = 'high';
  } else if (advice) {
    scene = 'advice';
    userIntent = 'advice';
    confidence = 'high';
  } else if (conflict || (assistantAffect === 'irritated' && emotion === 'angry')) {
    scene = 'conflict';
    userIntent = 'share';
    confidence = 'medium';
  } else if (serious) {
    scene = 'serious';
    userIntent = seriousReply || personalImpression ? 'ask' : 'share';
    confidence = 'medium';
  } else if (emotion === 'low' || emotion === 'tired') {
    scene = 'venting';
    userIntent = 'share';
    confidence = 'medium';
  } else if (emotion === 'playful' || emotion === 'happy' || matches(current, /逗你|开个玩笑/u)) {
    scene = 'playful';
    userIntent = 'play';
    confidence = 'medium';
  } else if (isClosing(current)) {
    scene = 'casual';
    userIntent = 'close';
    confidence = 'high';
  } else if (personalImpression || isGreeting(current) || /[?？]/u.test(current)) {
    scene = 'casual';
    userIntent = 'ask';
    confidence = 'medium';
  }

  const shouldOfferAdvice = scene === 'advice' && !boundary.noAdvice;
  const shouldAskQuestion = scene === 'safety'
    || (scene === 'advice' && !boundary.noQuestions)
    || (scene === 'casual' && userIntent === 'ask' && !boundary.noQuestions);

  return {
    scene,
    userEmotion: emotion,
    assistantAffect,
    userIntent,
    explicitNoAdvice: boundary.noAdvice,
    explicitNoQuestions: boundary.noQuestions,
    wantsQuietCompany: boundary.quiet,
    shouldOfferAdvice,
    shouldAskQuestion,
    confidence,
    directives: buildDirectives({
      scene,
      userEmotion: emotion,
      assistantAffect,
      noAdvice: boundary.noAdvice,
      noQuestions: boundary.noQuestions,
      quiet: boundary.quiet,
      shouldOfferAdvice,
      seriousReply,
      personalImpression,
    }),
  };
}

export function renderCompanionTurnAnalysis(analysis: CompanionTurnAnalysis): string {
  const lines = [
    '【本轮场景判断：服务端辅助线索，角色必须结合人设和历史自行复核】',
    `场景：${analysis.scene}；用户情绪：${analysis.userEmotion}；角色前一刻的情绪倾向：${analysis.assistantAffect}；判断把握：${analysis.confidence}`,
    `用户意图：${analysis.userIntent}；本轮是否适合主动给建议：${analysis.shouldOfferAdvice ? '可以，但要具体简短' : '不主动给'}`,
    `本轮是否可追问：${analysis.shouldAskQuestion ? '只在必要时问一个' : '不要靠问题收尾'}`,
    ...analysis.directives.map((directive) => `- ${directive}`),
  ];
  return lines.join('\n');
}
