export type City = { name: string; latitude: number; longitude: number; timezone: string; aliases: string[] };
// Coordinates are city centres, never the user's GPS position. The geocoder handles other places.
export const cities: City[] = [
  ['长沙', 28.2282, 112.9388, 'Asia/Shanghai', 'changsha'], ['北京', 39.9042, 116.4074, 'Asia/Shanghai', 'beijing'],
  ['上海', 31.2304, 121.4737, 'Asia/Shanghai', 'shanghai'], ['广州', 23.1291, 113.2644, 'Asia/Shanghai', 'guangzhou'],
  ['深圳', 22.5431, 114.0579, 'Asia/Shanghai', 'shenzhen'], ['杭州', 30.2741, 120.1551, 'Asia/Shanghai', 'hangzhou'],
  ['成都', 30.5728, 104.0668, 'Asia/Shanghai', 'chengdu'], ['重庆', 29.563, 106.5516, 'Asia/Shanghai', 'chongqing'],
  ['武汉', 30.5928, 114.3055, 'Asia/Shanghai', 'wuhan'], ['南京', 32.0603, 118.7969, 'Asia/Shanghai', 'nanjing'],
  ['西安', 34.3416, 108.9398, 'Asia/Shanghai', 'xian'], ['郑州', 34.7466, 113.6254, 'Asia/Shanghai', 'zhengzhou'],
  ['天津', 39.3434, 117.3616, 'Asia/Shanghai', 'tianjin'], ['苏州', 31.2989, 120.5853, 'Asia/Shanghai', 'suzhou'],
  ['青岛', 36.0671, 120.3826, 'Asia/Shanghai', 'qingdao'], ['济南', 36.6512, 117.1201, 'Asia/Shanghai', 'jinan'],
  ['合肥', 31.8206, 117.2272, 'Asia/Shanghai', 'hefei'], ['福州', 26.0745, 119.2965, 'Asia/Shanghai', 'fuzhou'],
  ['厦门', 24.4798, 118.0894, 'Asia/Shanghai', 'xiamen'], ['南昌', 28.6829, 115.8579, 'Asia/Shanghai', 'nanchang'],
  ['南宁', 22.817, 108.3669, 'Asia/Shanghai', 'nanning'], ['昆明', 25.0389, 102.7183, 'Asia/Shanghai', 'kunming'],
  ['贵阳', 26.647, 106.6302, 'Asia/Shanghai', 'guiyang'], ['海口', 20.044, 110.1999, 'Asia/Shanghai', 'haikou'],
  ['三亚', 18.2528, 109.5119, 'Asia/Shanghai', 'sanya'], ['哈尔滨', 45.8038, 126.535, 'Asia/Shanghai', 'harbin'],
  ['沈阳', 41.8057, 123.4315, 'Asia/Shanghai', 'shenyang'], ['长春', 43.8171, 125.3235, 'Asia/Shanghai', 'changchun'],
  ['大连', 38.914, 121.6147, 'Asia/Shanghai', 'dalian'], ['石家庄', 38.0428, 114.5149, 'Asia/Shanghai', 'shijiazhuang'],
  ['太原', 37.8706, 112.5489, 'Asia/Shanghai', 'taiyuan'], ['兰州', 36.0611, 103.8343, 'Asia/Shanghai', 'lanzhou'],
  ['西宁', 36.6171, 101.7782, 'Asia/Shanghai', 'xining'], ['银川', 38.4872, 106.2309, 'Asia/Shanghai', 'yinchuan'],
  ['呼和浩特', 40.8426, 111.7492, 'Asia/Shanghai', 'hohhot'], ['乌鲁木齐', 43.8256, 87.6168, 'Asia/Shanghai', 'urumqi'],
  ['拉萨', 29.652, 91.1721, 'Asia/Shanghai', 'lhasa'], ['香港', 22.3193, 114.1694, 'Asia/Hong_Kong', 'hong kong'],
  ['澳门', 22.1987, 113.5439, 'Asia/Macau', 'macau'], ['台北', 25.033, 121.5654, 'Asia/Taipei', 'taipei'],
  ['东京', 35.6762, 139.6503, 'Asia/Tokyo', 'tokyo'], ['首尔', 37.5665, 126.978, 'Asia/Seoul', 'seoul'],
  ['新加坡', 1.3521, 103.8198, 'Asia/Singapore', 'singapore'], ['伦敦', 51.5074, -0.1278, 'Europe/London', 'london'],
  ['巴黎', 48.8566, 2.3522, 'Europe/Paris', 'paris'], ['纽约', 40.7128, -74.006, 'America/New_York', 'new york'],
  ['洛杉矶', 34.0522, -118.2437, 'America/Los_Angeles', 'los angeles'], ['悉尼', -33.8688, 151.2093, 'Australia/Sydney', 'sydney'],
].map(([name, latitude, longitude, timezone, alias]) => ({ name: String(name), latitude: Number(latitude), longitude: Number(longitude), timezone: String(timezone), aliases: [String(name), String(alias)] }));

export function findCity(value: string): City | undefined {
  const normalized = value.toLowerCase().trim().replace(/市$/, '');
  return cities.find((city) => city.aliases.includes(normalized));
}
export function mentionedCities(text: string): City[] {
  // A time standard is not a requested weather location.
  const normalized = text.toLowerCase().replace(/北京时间|beijing\s+time/g, '');
  return cities.filter((city) => city.aliases.some((alias) => /[a-z]/.test(alias) ? new RegExp(`\\b${alias}\\b`, 'i').test(normalized) : normalized.includes(alias)));
}
