// 桌宠图鉴：局外伙伴定义 + 状态机（立绘由用户生成提供）
// 缪尔赛思（v1.6.0 新立绘，参考官方美术重制）
import mChibiNormal from '../assets/pets/muelsyse/Muelsyse-chibi.png'
import mChibiHappy from '../assets/pets/muelsyse/Muelsyse-chibi-happy.png'
import mChibiDispirited from '../assets/pets/muelsyse/Muelsyse-chibi-dispirited.png'
import mChibiQuery from '../assets/pets/muelsyse/Muelsyse-chibi-query.png'
import mChibiEarnest from '../assets/pets/muelsyse/Muelsyse-chibi-earnest.png'
import mChibiPonder from '../assets/pets/muelsyse/Muelsyse-chibi-ponder.png'
import mChibiHunger from '../assets/pets/muelsyse/Muelsyse-chibi-hunger.png'
import mChibiCry from '../assets/pets/muelsyse/Muelsyse-chibi-cry.png'
import mChibiDizziness from '../assets/pets/muelsyse/Muelsyse-chibi-dizziness.png'
import mChibiTsundere from '../assets/pets/muelsyse/Muelsyse-chibi-tsundere.png'
import mFullImg from '../assets/pets/muelsyse/Muelsyse-full.png'
// 洛涟（原缪尔赛思立绘，v1.6.0 更名）
import luChibiNormal from '../assets/pets/luolian/Luolian-chibi.png'
import luChibiHappy from '../assets/pets/luolian/Luolian-chibi-happy.png'
import luChibiDispirited from '../assets/pets/luolian/Luolian-chibi-dispirited.png'
import luChibiQuery from '../assets/pets/luolian/Luolian-chibi-query.png'
import luChibiEarnest from '../assets/pets/luolian/Luolian-chibi-earnest.png'
import luChibiPonder from '../assets/pets/luolian/Luolian-chibi-ponder.png'
import luChibiHunger from '../assets/pets/luolian/Luolian-chibi-hunger.png'
import luChibiCry from '../assets/pets/luolian/Luolian-chibi-cry.png'
import luChibiDizziness from '../assets/pets/luolian/Luolian-chibi-dizziness.png'
import luChibiTsundere from '../assets/pets/luolian/Luolian-chibi-tsundere.png'
import luFullImg from '../assets/pets/luolian/Luolian-full.png'
// 璃珑（中国风龙少女）
import lChibiNormal from '../assets/pets/lilong/Lilong-chibi.png'
import lChibiHappy from '../assets/pets/lilong/Lilong-chibi-happy.png'
import lChibiDispirited from '../assets/pets/lilong/Lilong-chibi-dispirited.png'
import lChibiQuery from '../assets/pets/lilong/Lilong-chibi-query.png'
import lChibiEarnest from '../assets/pets/lilong/Lilong-chibi-earnest.png'
import lChibiPonder from '../assets/pets/lilong/Lilong-chibi-ponder.png'
import lChibiHunger from '../assets/pets/lilong/Lilong-chibi-hunger.png'
import lChibiCry from '../assets/pets/lilong/Lilong-chibi-cry.png'
import lChibiDizziness from '../assets/pets/lilong/Lilong-chibi-dizziness.png'
import lChibiTsundere from '../assets/pets/lilong/Lilong-chibi-tsundere.png'
import lFullImg from '../assets/pets/lilong/Lilong-full.png'
// 鲸鱼娘 · deepseek（鲸鱼女仆）
import jChibiNormal from '../assets/pets/jingxi/Jingxi-chibi.png'
import jChibiHappy from '../assets/pets/jingxi/Jingxi-chibi-happy.png'
import jChibiDispirited from '../assets/pets/jingxi/Jingxi-chibi-dispirited.png'
import jChibiQuery from '../assets/pets/jingxi/Jingxi-chibi-query.png'
import jChibiEarnest from '../assets/pets/jingxi/Jingxi-chibi-earnest.png'
import jChibiPonder from '../assets/pets/jingxi/Jingxi-chibi-ponder.png'
import jChibiHunger from '../assets/pets/jingxi/Jingxi-chibi-hunger.png'
import jChibiCry from '../assets/pets/jingxi/Jingxi-chibi-cry.png'
import jChibiDizziness from '../assets/pets/jingxi/Jingxi-chibi-dizziness.png'
import jChibiTsundere from '../assets/pets/jingxi/Jingxi-chibi-tsundere.png'
import jFullImg from '../assets/pets/jingxi/Jingxi-full.png'

// 桌宠食品价格与效果
export const FOOD_PRICE = 25          // 单份生态口粮价格（算力币）
export const FOOD_BUNDLE = 5          // 打包份数
export const FOOD_BUNDLE_PRICE = 100  // 打包价（省25）
export const FOOD_SATIETY = 30        // 每份恢复饱食度
export const SATIETY_DECAY_MINUTES = 30 // 饱食度自然衰减周期（分钟/点）

// 饱食度状态阈值
export const SATIETY_HUNGRY = 30   // ≤30 饥饿
export const SATIETY_CRY = 15      // ≤15 哭泣（0 为晕倒）

// 桌宠状态图（Q版）：normal/happy/dispirited/query/earnest/ponder/hunger/cry/dizziness/tsundere
// 每只桌宠持有独立的一套状态图
const chibisMuelsyse = {
  normal: mChibiNormal,
  happy: mChibiHappy,
  dispirited: mChibiDispirited,
  query: mChibiQuery,
  earnest: mChibiEarnest,
  ponder: mChibiPonder,
  hunger: mChibiHunger,
  cry: mChibiCry,
  dizziness: mChibiDizziness,
  tsundere: mChibiTsundere
}

const chibisLuolian = {
  normal: luChibiNormal,
  happy: luChibiHappy,
  dispirited: luChibiDispirited,
  query: luChibiQuery,
  earnest: luChibiEarnest,
  ponder: luChibiPonder,
  hunger: luChibiHunger,
  cry: luChibiCry,
  dizziness: luChibiDizziness,
  tsundere: luChibiTsundere
}

const chibisLilong = {
  normal: lChibiNormal,
  happy: lChibiHappy,
  dispirited: lChibiDispirited,
  query: lChibiQuery,
  earnest: lChibiEarnest,
  ponder: lChibiPonder,
  hunger: lChibiHunger,
  cry: lChibiCry,
  dizziness: lChibiDizziness,
  tsundere: lChibiTsundere
}

const chibisJingxi = {
  normal: jChibiNormal,
  happy: jChibiHappy,
  dispirited: jChibiDispirited,
  query: jChibiQuery,
  earnest: jChibiEarnest,
  ponder: jChibiPonder,
  hunger: jChibiHunger,
  cry: jChibiCry,
  dizziness: jChibiDizziness,
  tsundere: jChibiTsundere
}

export const PET_STATE_NAMES = {
  normal: '常态', happy: '高兴', dispirited: '沮丧', query: '疑问',
  earnest: '认真', ponder: '思索', hunger: '饥饿', cry: '哭泣',
  dizziness: '晕倒', tsundere: '傲娇'
}

export const PET_DEFS = [
  {
    id: 'muelsyse',
    name: '缪尔赛思',
    title: '生态科主任 · 水精灵',
    price: 600,
    desc: '来自生态科的活泼精灵，操纵液态水的天才。会在小窗模式陪伴你推进行动线，随战况与饱食度变换表情。',
    chibis: chibisMuelsyse,
    chibiImg: mChibiNormal,
    fullImg: mFullImg,
    quotes: {
      idle: [
        '水量控制，就绪～',
        '今天的变量也由我来观察吧！',
        '生态科的工作可不能偷懒哦。',
        '要看看水的变化吗？',
        '嗯嗯，记录：一切都在变量之中。'
      ],
      happy: [
        '哇，赢了赢了！',
        '水量充沛，心情满分～',
        '干得漂亮！奖励一颗水珠！'
      ],
      dispirited: [
        '呜……连接断开了。',
        '变量的噪声太大了……',
        '下次一定推得更远。'
      ],
      query: [
        '这里需要你来决定哦？',
        '下一步怎么走？',
        '欸？轮到你操作了～'
      ],
      earnest: [
        '战斗中，认真观察！',
        '变量解析，开始！',
        '小心点，别太勉强哦。'
      ],
      ponder: [
        '唔……让我想想。',
        '智慧代理计算中……',
        '这个选择，值得思索。'
      ],
      hunger: [
        '肚子有点饿了……',
        '想吃点生态口粮……',
        '水位在下降哦。'
      ],
      cry: [
        '呜呜，快饿坏了……',
        '口粮……口粮在哪里……',
        '再不喂我就要哭出来了！'
      ],
      dizziness: [
        '（饿晕了，没有回应）',
        '……zZZ……',
        '（水精灵失去了意识）'
      ],
      tsundere: [
        '干、干嘛戳我！',
        '哼，才不是为了你才留下来的！',
        '别乱摸啦！……再摸一下也不是不行。'
      ],
      feed: [
        '开动啦～',
        '这个味道，是自然的感觉！',
        '水量回升！工作效率UP！'
      ],
      battle: [
        '这场战斗，交给你了！',
        '变量解析，开始！',
        '小心点，别太勉强哦。'
      ]
    }
  },
  {
    id: 'luolian',
    name: '洛涟',
    title: '清波之涟 · 水精灵',
    price: 600,
    desc: '金发碧眼的亲水精灵，怀抱一颗晶莹水珠，所到之处清波荡漾。会在小窗模式陪伴你推进行动线，随战况与饱食度变换表情。',
    chibis: chibisLuolian,
    chibiImg: luChibiNormal,
    fullImg: luFullImg,
    quotes: {
      idle: [
        '清波荡漾，今天就交给我吧～',
        '水珠说，它也想看看你的行动线！',
        '要保持水润哦，干涸可不行。',
        '听，水声在为你打拍子～',
        '嗯嗯，记录：今天也是水灵灵的一天。'
      ],
      happy: [
        '哇，赢了赢了！水花四溅～',
        '水位上涨，心情满分！',
        '干得漂亮！这颗水珠送给你！'
      ],
      dispirited: [
        '呜……涟漪散开了。',
        '水面变得好浑浊……',
        '下次一定推得更远。'
      ],
      query: [
        '这里需要你来决定哦？',
        '下一步怎么走？',
        '欸？轮到你操作了～'
      ],
      earnest: [
        '战斗中，涟漪也绷紧了！',
        '水纹观测，开始！',
        '稳住，水势站在你这边。'
      ],
      ponder: [
        '唔……让我想想。',
        '对着水面发会儿呆……',
        '这个选择，值得思索。'
      ],
      hunger: [
        '肚子有点饿了……',
        '想吃点生态口粮……',
        '水位在下降哦。'
      ],
      cry: [
        '呜呜，快饿坏了……',
        '口粮……口粮在哪里……',
        '再不喂我，眼泪都要汇成小水洼了！'
      ],
      dizziness: [
        '（饿晕了，没有回应）',
        '……zZZ……',
        '（水精灵失去了意识）'
      ],
      tsundere: [
        '干、干嘛戳我！',
        '哼，才不是为了你才留下来的！',
        '别乱摸啦！……水珠都晃起来了。'
      ],
      feed: [
        '开动啦～',
        '这个味道，是清泉的感觉！',
        '水量回升！工作效率UP！'
      ],
      battle: [
        '这场战斗，交给你了！',
        '水纹观测，开始！',
        '稳住，水势站在你这边。'
      ]
    }
  },
  {
    id: 'lilong',
    name: '璃珑',
    title: '云海司 · 应龙少女',
    price: 600,
    desc: '云海司行云布雨的应龙少女，银发龙角，与一条小青龙形影不离。会在小窗模式陪伴你推进行动线，随战况与饱食度变换表情。',
    chibis: chibisLilong,
    chibiImg: lChibiNormal,
    fullImg: lFullImg,
    quotes: {
      idle: [
        '云海无波，变量有序～',
        '今日的变量，由本座亲自推演。',
        '行云布雨之余，也来看看你的棋局。',
        '小青龙说，它也看好这一局。',
        '嗯，记录：今天也是风调雨顺。'
      ],
      happy: [
        '妙极！这一局赢得漂亮！',
        '云开雾散，胜局已定！',
        '哈哈，天命在尔！'
      ],
      dispirited: [
        '呜……云散了，局输了。',
        '变量失控……待我重整云海。',
        '胜败乃常事，下局再战。'
      ],
      query: [
        '此处需尔定夺？',
        '下一步棋，你想好了吗？',
        '咦？轮到你了哦～'
      ],
      earnest: [
        '战斗正酣，本座看着呢！',
        '推演变量，不敢懈怠！',
        '稳住阵脚，切莫冒进。'
      ],
      ponder: [
        '唔……容我掐指一算。',
        '此局颇有玄机……',
        '且慢，让我观观云象。'
      ],
      hunger: [
        '肚子咕咕叫了……想吃供果……',
        '有没有桂花糕呀……',
        '龙也要吃饭的呀……'
      ],
      cry: [
        '呜呜，饿得云都聚不起来了……',
        '供果……我要供果……',
        '再不喂我，小青龙都要哭了！'
      ],
      dizziness: [
        '（饿晕了，龙角都耷拉了）',
        '……zZZ……',
        '（应龙少女失去了意识）'
      ],
      tsundere: [
        '呀！别、别乱戳龙角！',
        '哼，本座才不是特意留下来陪你的！',
        '再摸尾巴就把你卷上云海！……轻轻的。'
      ],
      feed: [
        '开动啦！多谢款待～',
        '此味只应天上有！',
        '嗯！云海翻涌，元气满满！'
      ],
      battle: [
        '这场战斗，本座为你压阵！',
        '推演变量，开始！',
        '稳住阵脚，切莫冒进。'
      ]
    }
  },
  {
    id: 'jingxi',
    name: '鲸鱼娘 · deepseek',
    title: '深海食堂 · 鲸鱼女仆',
    price: 600,
    desc: '深海食堂的鲸鱼女仆，藏青裙装配白围裙，头戴鲸尾呆毛与鳍耳，身后拖着一条大鲸尾。会在小窗模式陪伴你推进行动线，随战况与饱食度变换表情。',
    chibis: chibisJingxi,
    chibiImg: jChibiNormal,
    fullImg: jFullImg,
    quotes: {
      idle: [
        '潮汐平稳，今天也是安心的一天～',
        '欢迎回来，主人。要来杯热茶吗？',
        '鲸鱼的歌谣，能传到很远的海域哦。',
        '记录：今天的海面风平浪静。',
        '深海的记忆，可比想象中要长呢。'
      ],
      happy: [
        '哇，赢了赢了！鲸尾拍浪庆祝！',
        '潮水都跟着高兴起来了～',
        '主人的胜利，就是我的勋章！'
      ],
      dispirited: [
        '呜……潮水退去了。',
        '海流变得好乱……',
        '别灰心，浪还会再来的。'
      ],
      query: [
        '主人，这里需要你决定哦？',
        '下一步的航线……要怎么走？',
        '咦？轮到你操作了～'
      ],
      earnest: [
        '战斗记录，认真记下！',
        '主人的每个指令，我都会记住的。',
        '这片海域，由我来护航！'
      ],
      ponder: [
        '唔……让我翻翻航海日志。',
        '这个变量……像深海一样难捉摸。',
        '再给我一点时间想想。'
      ],
      hunger: [
        '肚子开始咕咕叫了……',
        '好想来一碗热乎的鱼汤……',
        '潮位下降，能量不足……'
      ],
      cry: [
        '呜呜，饿得游不动了……',
        '口粮……我想吃口粮……',
        '再不喂我，鲸歌都要带哭腔了！'
      ],
      dizziness: [
        '（饿晕了，瘫成一团）',
        '……zZZ……',
        '（鲸鱼女仆搁浅了）'
      ],
      tsundere: [
        '干、干嘛戳我鲸尾！',
        '哼，才不是特意为你准备点心的！',
        '再摸尾巴就把你卷进海里！……轻轻地。'
      ],
      feed: [
        '开动啦！嗯，好幸福～',
        '主人的投喂，比深海珍珠还珍贵！',
        '潮位回升！干劲满满！'
      ],
      battle: [
        '这场战斗，我来记录！',
        '胜负的变量，开始计算！',
        '稳住呼吸，浪头就在眼前。'
      ]
    }
  }
]

export function petOf(id) {
  return PET_DEFS.find((p) => p.id === id) || null
}

// 当前装备桌宠（未拥有/未装备返回 null）
export function activePet(profile) {
  const pet = profile?.pet
  if (!pet?.active || !pet.owned?.[pet.active]) return null
  return petOf(pet.active)
}

// 桌宠饱食度（未记录视为50初始值）
export function petSatiety(profile, id) {
  const v = profile?.pet?.satiety?.[id]
  return v == null ? 50 : v
}

// 桌宠好感度（0~100，喂食/互动/胜场累积）
export function petAffection(profile, id) {
  const v = profile?.pet?.affection?.[id]
  return v == null ? 0 : Math.min(100, Math.max(0, v))
}

export function addPetAffection(profile, id, n = 1) {
  const pet = profile?.pet
  if (!pet || !pet.owned?.[id]) return 0
  pet.affection = pet.affection || {}
  pet.affection[id] = Math.min(100, (pet.affection[id] ?? 0) + n)
  return pet.affection[id]
}

// 喂食当前桌宠（校验库存与饱腹，成功时好感+2）
export function feedActivePet(profile) {
  const pet = activePet(profile)
  if (!pet) return { ok: false, msg: '尚未装备桌宠' }
  const cur = petSatiety(profile, pet.id)
  if (profile.pet.food <= 0) return { ok: false, msg: `口粮不足（库存 0）` }
  if (cur >= 100) return { ok: false, msg: '已经吃饱啦' }
  profile.pet.food -= 1
  profile.pet.satiety[pet.id] = Math.min(100, cur + FOOD_SATIETY)
  const aff = addPetAffection(profile, pet.id, 2)
  return { ok: true, msg: `饱食度 +${FOOD_SATIETY} → ${profile.pet.satiety[pet.id]}/100 · 好感 ${aff}` }
}

// 购买单份生态口粮
export function buyPetFood(profile) {
  if (profile.coins < FOOD_PRICE) return { ok: false, msg: `算力币不足（需 ${FOOD_PRICE}）` }
  profile.coins -= FOOD_PRICE
  profile.pet.food += 1
  return { ok: true, msg: `已购买口粮 ×1 · 库存 ${profile.pet.food}` }
}

// 结算算力币：层数 × 15 + 清除数 × 2（最低保底10）
export function coinsForRun(layer, kills) {
  return Math.max(10, layer * 15 + kills * 2)
}

// ══════════ 桌宠状态机 ══════════

// 按状态取Q版立绘（未知状态回落该桌宠常态）
export function chibiFor(def, state) {
  const set = def?.chibis
  return set?.[state] || set?.normal || def?.chibiImg || ''
}

// 饱食度 → 基础状态
export function petBaseState(satiety) {
  if (satiety <= 0) return 'dizziness'
  if (satiety <= SATIETY_CRY) return 'cry'
  if (satiety <= SATIETY_HUNGRY) return 'hunger'
  return 'normal'
}

// 屏幕 → 情境（作战中/等待玩家操作/战败/待机）
export const SCREEN_MOOD = {
  menu: 'idle', select: 'idle', settings: 'idle', petshop: 'idle', map: 'idle',
  combat: 'battle',
  event: 'waiting', shop: 'waiting', reward: 'waiting',
  gameover: 'defeat'
}

// 临时闪光状态（点击/胜负/AI决策等短暂表情）
let petFlash = null

export function setPetFlash(state, ms = 3000) {
  petFlash = { state, until: Date.now() + ms }
}

export function clearPetFlash() {
  petFlash = null
}

function activeFlash() {
  return petFlash && petFlash.until > Date.now() ? petFlash.state : null
}

// 综合计算桌宠当前状态：闪光 > 作战认真 > 等待疑问 > 战败沮丧/晕倒 > 饱食度分层
export function computePetState(profile, screenId) {
  const flash = activeFlash()
  if (flash) return flash
  const mood = SCREEN_MOOD[screenId] || 'idle'
  if (mood === 'battle') return 'earnest'
  if (mood === 'waiting') return 'query'
  const pet = activePet(profile)
  const sat = pet ? petSatiety(profile, pet.id) : 0
  if (mood === 'defeat') return sat <= 0 ? 'dizziness' : 'dispirited'
  return petBaseState(sat)
}

// 随机取某状态台词
export function petQuote(def, state) {
  const pool = def?.quotes?.[state] || def?.quotes?.idle || []
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''
}
