/**
 * 开发期数据生成工具，从项目根目录运行；不参与浏览器页面加载。
 * 读取 Natural Earth 原始资料和基础城市库，生成 src/data/countries.js。
 * 首都、中文名与 IANA 映射需要显式维护，不能从最大城市或最近城市无条件推断。
 */
// Build local country geometry and metadata from Natural Earth source files.
const fs = require('node:fs'),
  vm = require('node:vm');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of [
  'src/vendor/d3-array.min.js',
  'src/vendor/d3-geo.min.js',
  'src/data/cities.js',
])
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
const cities = sandbox.window.CITIES;
const source = JSON.parse(fs.readFileSync('scripts/data/countries-source.geojson', 'utf8'));
const places = JSON.parse(fs.readFileSync('scripts/data/capitals-source.geojson', 'utf8')).features;
const distance = (a, b) => sandbox.d3.geoDistance([a.lon, a.lat], [b.longitude, b.latitude]);
const extra = `BMU|汉密尔顿|Atlantic/Bermuda
TGO|洛美|Africa/Lome
SWZ|姆巴巴内|Africa/Mbabane
SOL|哈尔格萨|Africa/Mogadishu
SLE|弗里敦|Africa/Freetown
STP|圣多美|Africa/Sao_Tome
SMR|圣马力诺|Europe/San_Marino
VCT|金斯敦|America/St_Vincent
LCA|卡斯特里|America/St_Lucia
KNA|巴斯特尔|America/St_Kitts
MCO|摩纳哥|Europe/Monaco
MRT|努瓦克肖特|Africa/Nouakchott
MWI|利隆圭|Africa/Blantyre
LIE|瓦杜兹|Europe/Vaduz
LBR|蒙罗维亚|Africa/Monrovia
LSO|马塞卢|Africa/Maseru
KOS|普里什蒂纳|Europe/Belgrade
GNB|比绍|Africa/Bissau
GIN|科纳克里|Africa/Conakry
GRD|圣乔治|America/Grenada
GMB|班珠尔|Africa/Banjul
GNQ|马拉博|Africa/Malabo
DMA|罗索|America/Dominica
CIV|亚穆苏克罗|Africa/Abidjan
COM|莫罗尼|Indian/Comoro
CAF|班吉|Africa/Bangui
CPV|普拉亚|Atlantic/Cape_Verde
MMR|内比都|Asia/Yangon
BOL|苏克雷|America/La_Paz
BRB|布里奇敦|America/Barbados
ATG|圣约翰|America/Antigua
AND|安道尔城|Europe/Andorra`;
const definitions = new Map(
  extra.split('\n').map((line) => {
    const [id, name, zone] = line.split('|');
    return [id, { name, zone }];
  })
);
// Explicit capital / administrative-center choices; do not infer a capital
// from a country's largest city. Coordinates are used only when absent in NE.
const choices = {
  GNQ: ['Ciudad de la Paz', '和平城', 'Africa/Malabo', 1.613, 10.823],
  ZAF: ['Pretoria'],
  BOL: ['Sucre'],
  CIV: ['Yamoussoukro'],
  TZA: ['Dodoma', '多多马', 'Africa/Dar_es_Salaam'],
  BEN: ['Porto-Novo', '波多诺伏', 'Africa/Porto-Novo'],
  BDI: ['Gitega', '基特加', 'Africa/Bujumbura', -3.4264, 29.9306],
  LKA: ['Sri Jayawardenepura Kotte', '斯里贾亚瓦德纳普拉科特', 'Asia/Colombo'],
  SDS: ['Juba'],
  PSX: ['Ramallah'],
  HKG: ['Hong Kong'],
  MAC: ['Macau'],
  TWN: ['Taipei'],
  COK: ['Avarua'],
  NIU: ['Alofi'],
  NRU: ['Yaren'],
  PCN: ['Adamstown'],
  PRI: ['San Juan'],
  GUM: ['Agana', '阿加尼亚', 'Pacific/Guam'],
  ASM: ['Pago Pago'],
  PYF: ['Papeete'],
  NCL: ['Nouméa'],
  GRL: ['Nuuk', '努克', 'America/Nuuk'],
  FLK: ['Stanley', '斯坦利', 'Atlantic/Stanley'],
  CYM: ['George Town', '乔治敦', 'America/Cayman'],
  TCA: ['Grand Turk', '科伯恩城', 'America/Grand_Turk'],
  IMN: ['Douglas', '道格拉斯', 'Europe/Isle_of_Man'],
  CUW: ['Willemstad', '威廉斯塔德', 'America/Curacao'],
  ABW: ['Oranjestad', '奥拉涅斯塔德', 'America/Aruba'],
  ALD: ['Mariehamn', '玛丽港', 'Europe/Mariehamn'],
  MNP: ['Saipan', '塞班', 'Pacific/Saipan', 15.19, 145.75],
  VIR: ['Charlotte Amalie', '夏洛特阿马利亚', 'America/St_Thomas', 18.34, -64.93],
  VGB: ['Road Town', '罗德城', 'America/Tortola', 18.43, -64.62],
  AIA: ['The Valley', '瓦利', 'America/Anguilla', 18.22, -63.05],
  SHN: ['Jamestown', '詹姆斯敦', 'Atlantic/St_Helena', -15.93, -5.72],
  JEY: ['Saint Helier', '圣赫利尔', 'Europe/Jersey', 49.19, -2.11],
  GGY: ['Saint Peter Port', '圣彼得港', 'Europe/Guernsey', 49.45, -2.54],
  MSR: ['Brades', '布莱兹', 'America/Montserrat', 16.79, -62.21],
  SPM: ['Saint-Pierre', '圣皮埃尔', 'America/Miquelon', 46.78, -56.18],
  WLF: ['Mata Utu', '马塔乌图', 'Pacific/Wallis', -13.28, -176.18],
  MAF: ['Marigot', '马里戈', 'America/Marigot', 18.07, -63.08],
  BLM: ['Gustavia', '古斯塔维亚', 'America/St_Barthelemy', 17.9, -62.85],
  FRO: ['Torshavn', '托尔斯港', 'Atlantic/Faroe', 62.01, -6.77],
  CYN: ['Nicosia', '尼科西亚', 'Asia/Famagusta', 35.18, 33.36],
  SXM: ['Philipsburg', '菲利普斯堡', 'America/Lower_Princes', 18.03, -63.05],
  NFK: ['Kingston', '金斯敦', 'Pacific/Norfolk', -29.06, 167.96],
  IOA: ['West Island', '西岛', 'Indian/Cocos', -12.19, 96.83],
};
const added = [],
  features = [];
/** 按球面距离查找已有城市，仅供后续匹配判断，不代表该城市自动成为首都。 */
function nearestCity(p) {
  return cities.slice().sort((a, b) => distance(a, p) - distance(b, p))[0];
}
/** 优先使用人工首都修正，再读取 Natural Earth 首都属性；必要时补充城市并验证 IANA 标识可用。 */
function getCapital(p) {
  const code = p.ADM0_A3,
    choice = choices[code],
    alias = code === 'SDS' ? 'SSD' : code;
  let candidates = places.filter((c) => c.properties.adm0_a3 === alias).map((c) => c.properties);
  let capital = choice
    ? candidates.find((c) => c.name === choice[0])
    : candidates.find((c) => c.adm0cap === 1);
  if (!capital && choice) {
    const existing = cities.find((c) => c.en === choice[0]);
    if (existing) return existing.id;
    if (choice.length >= 5)
      capital = { name: choice[0], latitude: choice[3], longitude: choice[4] };
  }
  if (!capital) return null;
  const nearest = nearestCity(capital),
    definition = definitions.get(code);
  // No cross-border nearest-city substitution: only reuse a matching capital.
  if (!definition && !choice?.[1] && distance(nearest, capital) < 0.008) return nearest.id;
  const zone = choice?.[2] || definition?.zone;
  if (!zone) {
    if (distance(nearest, capital) < 0.008) return nearest.id;
    return null;
  }
  const city = {
    id: cities.length,
    name: choice?.[1] || definition.name,
    en: capital.name,
    country: p.NAME_ZH,
    countryEn: p.ADMIN,
    lat: capital.latitude,
    lon: capital.longitude,
    zone,
  };
  new Intl.DateTimeFormat('en', { timeZone: zone });
  cities.push(city);
  added.push(city);
  return city.id;
}
for (const f of source.features) {
  const p = f.properties,
    capital = getCapital(p),
    geometry = JSON.parse(JSON.stringify(f.geometry), (_, v) =>
      typeof v === 'number' ? Math.round(v * 10000) / 10000 : v
    );
  if (sandbox.d3.geoArea(geometry) > 2 * Math.PI) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const poly of polys) for (const ring of poly) ring.reverse();
  }
  const names = {
    CHN: '中国',
    USA: '美国',
    GBR: '英国',
    RUS: '俄罗斯',
    KOR: '韩国',
    PRK: '朝鲜',
    ARE: '阿联酋',
    COD: '刚果（金）',
    COG: '刚果（布）',
    TWN: '中国台湾',
    HKG: '中国香港',
    MAC: '中国澳门',
  };
  features.push({
    id: p.ADM0_A3,
    name: names[p.ADM0_A3] || p.NAME_ZH || p.ADMIN,
    en: p.ADMIN,
    lat: p.LABEL_Y,
    lon: p.LABEL_X,
    rank: p.LABELRANK,
    capital,
    geometry,
  });
}
const cityRegions = [];
const namesToCountry = new Map();
features.forEach((country, index) => {
  const raw = source.features[index].properties;
  for (const name of [country.name, country.en, raw.NAME_ZH, raw.NAME_EN])
    namesToCountry.set(name, country);
});
for (const city of cities) {
  const special =
    city.name === '香港'
      ? 'HKG'
      : city.name === '澳门'
        ? 'MAC'
        : city.zone === 'Asia/Taipei'
          ? 'TWN'
          : null;
  // Coastal city coordinates are rounded in the city catalog and may lie
  // just offshore. Retain their explicit administrative country in that case.
  const match =
    (special && features.find((f) => f.id === special)) ||
    features.find((f) => sandbox.d3.geoContains(f.geometry, [city.lon, city.lat])) ||
    namesToCountry.get(city.country) ||
    namesToCountry.get(city.countryEn);
  if (match) cityRegions.push([city.id, match.id, match.name]);
}
fs.writeFileSync(
  'src/data/countries.js',
  '/* Natural Earth 1:50m countries; see README.md for sources. */\nwindow.CITIES.push(...' +
    JSON.stringify(added) +
    ');\nwindow.COUNTRIES=' +
    JSON.stringify(features) +
    ';\n' +
    JSON.stringify(cityRegions) +
    '.forEach(([id,territory,region])=>Object.assign(window.CITIES[id],{territory,region}));\n'
);
console.log(
  `Built ${features.length} territories, ${features.filter((f) => f.capital !== null).length} capitals/centers, ${cities.length} cities.`
);
console.log(
  'No capital data:',
  features
    .filter((f) => f.capital === null)
    .map((f) => f.name)
    .join(', ')
);
