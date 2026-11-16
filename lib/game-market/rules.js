'use strict';

const crypto = require('crypto');
const {
  CONTENT_VERSION, CURRENT_SCHEMA_VERSION, MARKET_VERSION, RULESET, RULESET_HASH, RULESET_VERSION, upgradeState,
} = require('./version');
const {
  achievementText, ensureProgressionPeriods, eventText, honorText, recordSuccessfulAction, taskText,
} = require('./progression');

const MAX_SAFE_AMOUNT = 9_000_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WORK_COOLDOWN_MS = HOUR;
const WORK_DAILY_LIMIT = RULESET.work.dailyLimit;
const MEMBER_ABSENCE_CONFIRM_DELAY = 60_000;

const PLAYFUL_SCENES = Object.freeze({
  join: [
    '🎟️ 市场大门“叮”一声打开，你的虚拟钱包正式上岗',
    '😎 你戴着空气墨镜走进市场，气势先充值成功',
    '🥁 摊主们敲锣欢迎，新玩家加载完毕',
    '🛒 你推着一辆空购物车入场，梦想已经装满',
    '🎪 市场帷幕缓缓拉开，你站到了聚光灯下',
  ],
  exit: [
    '🧳 你潇洒收摊，管理员抱着计算器目送你离场',
    '🏖️ 你拔掉虚拟工牌，钱包宣布进入休假模式',
    '👋 你挥挥手退出市场，只留下价格牌在风中摇摆',
    '🚪 你轻轻带上市场大门，动作像电影散场',
    '🛶 你划着自由的小船离开，合同在岸边挥手',
  ],
  status: [
    '🧮 财务小助手翻了三遍账本，终于把数字对齐',
    '🔍 会计拿出放大镜，你的家底一览无余',
    '📋 市场体检报告出炉，数字们排队站好了',
    '🩺 虚拟钱包做完体检，报告刚刚打印出来',
    '🛰️ 市场雷达扫描完毕，你的资产无处躲藏',
  ],
  ranking: [
    '🏆 榜单刚出炉，围观群众已经搬好小板凳',
    '📣 市场广播响了，请各位富豪注意表情管理',
    '🪜 排名梯子摆好了，大家开始偷偷踮脚',
    '🎬 排行大戏开场，数字们抢着站到前排',
    '🔔 榜单钟声敲响，钱包们集体屏住呼吸',
  ],
  'last-ranking': [
    '📜 旧榜单从抽屉里翻出来了，灰都替你吹干净了',
    '🕰️ 时光机启动，上一期的风云人物重新登场',
    '🗂️ 管理员翻开历史账本，当年的数字还很精神',
    '📼 市场按下倒带键，往期名场面再次播放',
    '🏺 历史榜单被小心出土，排名纹路清晰可见',
  ],
  'bank-status': [
    '🏦 柜员敲了敲算盘，你的金库回了个响',
    '🔐 金库门转了三圈，余额郑重登场',
    '💳 虚拟银行打印了小票，墨还热乎着',
    '🧾 银行小票缓缓吐出，数字排版格外端正',
    '🪙 柜员摇了摇存钱罐，听声辨认你的家底',
  ],
  work: [
    '🧱 你搬完今天的砖，砖头都夸你手法专业',
    '💼 你假装忙得飞起，老板居然真的结账了',
    '🛠️ 你完成一单神秘兼职，工位为你鼓掌三秒',
    '☕ 你靠一杯空气咖啡撑完全场，工资顺利到账',
    '🖨️ 你修好了那台只会吐白纸的打印机，老板当场结算',
  ],
  'bank-upgrade': [
    '🏗️ 金库连夜加盖一层，施工队只收虚拟币',
    '🛡️ 银行换上更厚的门，连蚊子都要刷卡',
    '📈 柜员按下升级键，算盘当场超频',
    '🔧 工程队拧紧最后一颗螺丝，金库容量变大了',
    '🏢 你的银行悄悄长高一层，电梯还没来得及装',
  ],
  'bank-deposit': [
    '🐷 存钱罐吃得很满意，还打了个数字味的嗝',
    '🏦 柜员把钱推进金库，动作像藏最后一块蛋糕',
    '💰 你的虚拟币排着队住进了银行宿舍',
    '📦 现金被仔细打包，送进了恒温金库',
    '🛏️ 虚拟币办好入住，今晚睡在银行上铺',
  ],
  'bank-withdraw': [
    '🛒 金库门一开，虚拟币排队回到你的口袋',
    '💸 柜员依依不舍地松手，现金重获自由',
    '🧲 你对金库施展召唤术，余额立刻响应',
    '📤 现金办完退房手续，拖着行李回来了',
    '🪄 你挥了挥取款小票，虚拟币立刻现身',
  ],
  recruit: [
    '🤝 人才市场响起掌声，这份虚拟合同正式生效',
    '📝 你掏出一份看不懂但很有气势的合同，签约成功',
    '📢 招募喇叭一响，新伙伴被你的诚意打动了',
    '🧲 你的招募牌突然有了磁力，新伙伴顺利入队',
    '🎣 你甩出诚意满满的合同，人才稳稳上钩',
  ],
  release: [
    '🕊️ 合同化成纸飞机，对方带着自由飞走了',
    '🎓 今日份毕业手续办妥，江湖再见',
    '🚪 你打开自由之门，还贴心地扶了一下门',
    '✂️ 合同上的线被剪断，自由模式重新上线',
    '🎈 你松开手，伙伴像气球一样奔向自由',
  ],
  'train-success': [
    '💪 教练吹响口哨，这次训练居然没有人摸鱼',
    '🔥 训练木桩冒出青烟，实力确实涨了',
    '🏋️ 汗水没有白流，连镜子都点头认可',
    '🥋 最后一组动作完成，实力条亮起了绿灯',
    '📣 教练喊到嗓子冒烟，训练成果终于到账',
  ],
  'train-fail': [
    '🥴 教练看了看成绩单，决定先假装没看见',
    '🫠 训练很努力，效果可能堵在路上了',
    '🪵 木桩毫发无伤，但你的毅力得到了锻炼',
    '🌀 动作完成得很完整，成果却迷路了',
    '🧘 训练场一片安静，实力条选择原地思考',
  ],
  'steal-success': [
    '🥷 你踩着静音拖鞋出手，钱包保安刚好在打盹',
    '🕵️ 潜行计划完美收官，连路灯都替你保密',
    '🐾 你轻手轻脚完成任务，只留下一个问号',
    '🌙 你借着月光完成行动，影子都没跟上',
    '🎩 你表演了一场钱包魔术，硬币成功换了口袋',
  ],
  'steal-fail': [
    '🚨 你刚伸手，虚拟警报就唱起了生日歌',
    '🫣 潜行三秒就被发现，演技还得继续进修',
    '👮 钱包保安今天没摸鱼，罚单先到一步',
    '💡 你刚准备行动，头顶的探照灯突然加班',
    '🪤 计划写得很漂亮，第一步就踩中了铃铛',
  ],
  buyback: [
    '🔓 你拍下虚拟赎身费，合同当场松开了手',
    '🗽 自由身重新到账，空气都闻起来更贵了',
    '✂️ 合同被一剪两断，剪刀表示很有成就感',
    '🧾 赎身小票打印完毕，自由重新签收',
    '🪁 你扯断合同线，身份像风筝一样飞回手里',
  ],
  'duel-win': [
    '🥊 擂台锣声一响，你的胜利姿势已经摆好',
    '🏅 围观群众还没反应过来，你已经赢了',
    '⚔️ 裁判高举你的手，背景音乐自动播放',
    '🎯 你精准命中胜利，记分牌开心得闪了两下',
    '🦸 你完成最后一击，披风在不存在的风里飘扬',
  ],
  'duel-loss': [
    '🩹 擂台经验成功到账，胜利暂时堵车',
    '🥲 裁判拍了拍你，姿势很帅，下次争取赢',
    '🧯 这场火花很足，可惜奖牌跑去了对面',
    '🛟 你从擂台边缘爬回来，经验条倒是涨了',
    '🎭 结局略有反转，但你的登场动作依然满分',
  ],
  'rank-win': [
    '🚀 段位电梯向上运行，这次没有停错楼层',
    '🎮 排位之神点了点头，积分顺利装进口袋',
    '📈 排行榜抖了一下，你的位置往上挪了',
    '🧗 你抓住段位绳索，稳稳向上爬了一截',
    '🌟 胜利星星落进口袋，积分跟着亮了起来',
  ],
  'rank-loss': [
    '🛝 积分坐了趟滑梯，经验值倒是爬了上来',
    '🎯 这局差一点命中胜利，下局再校准准星',
    '🧗 排位山路有点滑，鞋带系紧再来',
    '🧊 段位地板突然打滑，你及时扶住了经验值',
    '🗺️ 胜利路线临时绕路，下一局重新导航',
  ],
});

const PLAYFUL_REACTIONS = Object.freeze([
  '围观群众认真地点了点头',
  '旁边的计算器沉默三秒后表示认可',
  '市场广播把这件事播了两遍',
  '连空气都配合地鼓了掌',
  '管理员把它记进了《离谱但有效》档案',
  '路过的招财猫临时加了个班',
  '账本上的数字排队敬了个礼',
  '隔壁摊主看完决定回去练习',
  '虚拟钱包发来一封表扬信',
  '现场唯一的板凳都激动得挪了两厘米',
]);

const NOTICE_SCENES = Object.freeze({
  'work-cooldown': [
    '⏳ 你刚准备再次上班，工位把“营业中”翻成了“正在散热”',
    '🪑 椅子看见你又回来，连夜递交了一小时休息申请',
    '🧱 砖头们临时开会，决定满一小时后再排队让你搬',
    '☕ 老板端来一杯空气咖啡，说喝完这一小时再开工',
    '🕐 打卡机捂住卡槽，认真执行一小时劳逸结合制度',
  ],
  cooldown: [
    '⏳ 计时器抱紧进度条，暂时不肯放行',
    '🧊 技能按钮还在冷却，摸上去能给汽水降温',
    '🛑 裁判举起暂停牌，秒针正在努力赶路',
    '🐌 冷却条背着小书包，一格一格往终点挪',
    '🔋 本次操作正在充能，插头已经插得很认真',
  ],
  'daily-limit': [
    '📅 今日份次数已经打卡下班，明天才肯重新上岗',
    '🧮 计数器数到上限后躺平了，算盘珠子拒绝加班',
    '🚧 今日通道挂出“额度用完”的牌子，连风都绕道走',
    '🎟️ 今天的体验券一张不剩，票根倒是攒得很整齐',
    '🌙 今日次数已经收摊，正在等待北京时间零点开门',
  ],
  insufficient: [
    '👛 钱包翻了个底朝天，只抖出一阵很有诚意的风',
    '🪙 虚拟币排队点名，人数明显撑不起这次行动',
    '🧾 收银台算了三遍，余额依然倔强地不够',
    '🏦 金库回了个空荡荡的回声，建议先去赚一点',
    '💸 预算刚走到门口，就被价格牌礼貌地请了回来',
  ],
  target: [
    '🔍 放大镜找了三圈，目标还是躲得比影子快',
    '🎯 准星认真瞄了半天，发现靶子今天没有上班',
    '🧭 指南针转成了小风扇，仍没找到可操作对象',
    '📣 市场广播喊了三遍名字，只有回声前来报到',
    '🕵️ 侦察员带着空白名单回来，表情十分专业',
  ],
  relationship: [
    '🪢 关系线打了个结，规则管理员拿着梳子赶来劝阻',
    '📜 合同翻到这一页，自己把“不允许”三个字圈了起来',
    '🚦 关系信号灯亮起红灯，双方资料暂时原地待命',
    '🧩 这块关系拼图放不进去，硬塞会让整张图抗议',
    '🛡️ 市场关系保护罩启动，本次操作被温柔弹回',
  ],
  capacity: [
    '📦 容量已经塞到拉链冒汗，再放一个就要表演爆箱',
    '🧮 上限管理员数完最后一格，郑重挂出满员牌',
    '🚪 当前名额全部坐满，门口的小板凳也没有空位',
    '🏗️ 系统容量正在等扩建，本次先在围栏外稍候',
    '🗄️ 最后一格抽屉已经入住，管理员正在寻找新柜子',
  ],
  participation: [
    '🎫 参与资格正在后台核对，闸机暂时保持严肃',
    '🪪 市场通行证抖了两下，本次没有亮起绿灯',
    '🚪 入口守卫翻完名单，建议先把参与状态处理好',
    '📋 玩家状态还没站稳，操作按钮先扶着墙等一会儿',
    '🛰️ 成员雷达正在校准，本次行动先安全停靠',
  ],
  rule: [
    '📏 规则尺子突然伸出来，刚好挡住了这次操作',
    '🧑‍⚖️ 市场裁判吹响口哨，并递来一张清楚的原因单',
    '🚧 规则路障及时升起，旁边还贴心地画了绕行说明',
    '📚 游戏手册自动翻到相关页，书签都替你夹好了',
    '🔔 规则铃响了一声，本次操作停在提交线之前',
  ],
});

const NOTICE_REACTIONS = Object.freeze([
  '沙漏翻了个身，表示急也没有用',
  '旁边的秒针认真点了点头',
  '市场广播用播音腔重复了一遍原因',
  '围观群众递来一张“稍后再来”小票',
  '计算器敲了敲桌面，确认事实没有算错',
  '管理员把原因盖上了清晰可见的章',
  '路过的招财猫建议先看下面的提示',
  '提示牌往前挪了两厘米，生怕你没看见',
  '虚拟钱包摊开双手，动作十分标准',
  '现场安静三秒，给事实信息留足了版面',
]);

const PLAYFUL_LINES = Object.freeze(Object.fromEntries(Object.entries(PLAYFUL_SCENES).map(([key, scenes]) => {
  const lines = scenes.flatMap((scene) => PLAYFUL_REACTIONS.map((reaction) => `${scene}，${reaction}。`));
  if (lines.length !== 50 || new Set(lines).size !== 50) throw new Error(`invalid_playful_catalog:${key}`);
  return [key, Object.freeze(lines)];
})));

const NOTICE_LINES = Object.freeze(Object.fromEntries(Object.entries(NOTICE_SCENES).map(([key, scenes]) => {
  const lines = scenes.flatMap((scene) => NOTICE_REACTIONS.map((reaction) => `${scene}，${reaction}。`));
  if (lines.length !== 50 || new Set(lines).size !== 50) throw new Error(`invalid_notice_catalog:${key}`);
  return [key, Object.freeze(lines)];
})));

const PLAYFUL_TITLES = Object.freeze({
  join: '加入市场', exit: '退出市场', status: '市场状态', ranking: '本期排行', 'last-ranking': '上期排行',
  'bank-status': '银行状态', work: '打工结算', 'bank-upgrade': '银行升级', 'bank-deposit': '银行存款',
  'bank-withdraw': '银行取款', recruit: '招募结果', release: '放生结果', 'train-success': '训练结果',
  'train-fail': '训练结果', 'steal-success': '夺取结果', 'steal-fail': '夺取结果', buyback: '回购结果',
  'duel-win': '决斗结果', 'duel-loss': '决斗结果', 'rank-win': '排位结果', 'rank-loss': '排位结果',
});

function playfulLinesFor(key) {
  return PLAYFUL_LINES[key] ? [...PLAYFUL_LINES[key]] : [];
}

function noticeLinesFor(key) {
  return NOTICE_LINES[key] ? [...NOTICE_LINES[key]] : [];
}

function stableLine(request, key, lines) {
  const stableId = request.messageId || request.digest || `${request.senderId || ''}:${request.now || ''}`;
  const digest = crypto.createHash('sha256').update(`${stableId}\n${key}`).digest();
  return lines[digest.readUInt32BE(0) % lines.length];
}

function playfulReply(request, key, factualReply) {
  const lines = PLAYFUL_LINES[key];
  if (!Array.isArray(lines) || lines.length === 0) return factualReply;
  return `${stableLine(request, key, lines)}\n\n📌 ${PLAYFUL_TITLES[key] || '操作结果'}\n${factualReply}`;
}

function playfulNotice(request, key, title, factualReply) {
  const lines = NOTICE_LINES[key] || NOTICE_LINES.rule;
  return `${stableLine(request, `notice:${key}`, lines)}\n\n📌 ${title}\n${factualReply}`;
}

function remainingTimeText(milliseconds) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分钟`);
  if (remainder) parts.push(`${remainder} 秒`);
  return parts.join(' ') || '1 秒';
}

function marketHelpText(cadence = 'month', noReset = true) {
  const period = cadence === 'month' ? '月榜' : '周榜';
  const settlement = noReset ? '不清零，保留累计资产' : '到期结算并清零';
  return [
    '🎮 小米粒群友市场帮助',
    `赛制：${period}｜${settlement}`,
    '参与：群成员默认参与，可主动退出',
    '',
    '💰 赚钱与银行',
    `• #打工　赚取虚拟币（冷却 1 小时，每日 ${WORK_DAILY_LIMIT} 次）`,
    '• #银行 状态　查看余额、限额和等级',
    '• #银行 存 <金额|全部>',
    '• #银行 取 <金额|全部>',
    '• #银行 升级　提升存款限额',
    '',
    '🤝 群友关系',
    '• #招募 [群友]　招募或转招募群友',
    '• #放生 [群友]　解除名下群友关系',
    '• #回购自身　解除自己被招募的关系',
    '',
    '⚔️ 互动挑战',
    '• #训练 [群友]　训练自己或名下群友',
    '• #夺取 [群友]　不写对象时随机夺取',
    '• #决斗　随机匹配对手（冷却 3 分钟，每日 10 次）',
    '• #排位 [名下群友]　参加排位赛',
    '',
    '📊 查询',
    '• #市场状态　查看资产、关系和今日次数',
    '• #排行　查看累计资产榜和当月积分榜',
    '• #上期排行　查看上一期榜单',
    '• #市场版本　查看玩法、规则和账本版本',
    '• #市场记录　查看最近 10 条操作',
    '• #市场任务　查看今日任务',
    '• #市场成就　查看永久成就',
    '• #市场荣誉　查看月度荣誉',
    '• #市场事件　查看本周群体事件',
    '',
    '🚪 参与设置',
    '• #加入市场',
    '• #退出市场',
    '',
    '📝 发送示例',
    '@小米粒 #打工',
    '@小米粒 #招募 张三',
    '@小米粒 #银行 存 全部',
    '',
    '💡 选择对象',
    '• 训练、招募、放生、排位不写对象：只有 1 个候选时直接执行；多个候选时返回临时编号。',
    '• 收到编号后，请在 60 秒内发送，例如：@小米粒 #招募 #1',
    '• 裸 #夺取 只会随机选择当前有币且可操作的其他群友。',
  ].join('\n');
}

function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_SAFE_AMOUNT ? number : fallback;
}

function checked(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_AMOUNT) throw new Error('amount_overflow');
  return value;
}

function formatShanghai(ms) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

function sanitizeName(value) {
  return String(value || '群友').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || '群友';
}

function initialPlayer(id, name, now) {
  return {
    id,
    name: sanitizeName(name),
    coins: 0,
    value: 100,
    recruitedBy: null,
    recruits: [],
    bankBalance: 0,
    bankLevel: 1,
    lastInterestTime: now,
    rating: 1000,
    lastWorkAt: 0,
    workDayId: shanghaiDayId(now),
    workDailyCount: 0,
    lastTrainAt: 0,
    trainDayId: shanghaiDayId(now),
    trainDailyCount: 0,
    lastTrainedAt: 0,
    trainedDayId: shanghaiDayId(now),
    trainedDailyCount: 0,
    lastStealAt: 0,
    stealDayId: shanghaiDayId(now),
    stealDailyCount: 0,
    stealShieldUntil: 0,
    stealVictimDayId: shanghaiDayId(now),
    stealVictimDailyCount: 0,
    lastDuelAt: 0,
    duelDayId: shanghaiDayId(now),
    duelDailyCount: 0,
    lastRankAt: 0,
    rankDayId: shanghaiDayId(now),
    rankDailyCount: 0,
    lastRankParticipantAt: 0,
    rankParticipantDayId: shanghaiDayId(now),
    rankParticipantDailyCount: 0,
    recruitLockedUntil: 0,
    lastBuybackAt: 0,
    buybackCount: 0,
    buybackMonthId: '',
    bankInterestCarry: 0,
    seasonPoints: 0,
    cosmeticTickets: 0,
    progressDayId: '',
    dailyPointCommands: [],
    taskProgress: {},
    achievementStats: {},
    achievements: [],
    isolated: false,
    missingSnapshotId: null,
    missingAt: null,
  };
}

function emptyState(now, cadence = 'month', noReset = true) {
  const bounds = periodBounds(now, cadence);
  return {
    meta: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      marketVersion: MARKET_VERSION,
      rulesetVersion: RULESET_VERSION,
      contentVersion: CONTENT_VERSION,
      rulesetHash: RULESET_HASH,
      cadence,
      noReset: Boolean(noReset),
      periodStartAt: bounds.startAt,
      periodEndAt: bounds.endAt,
      periodId: bounds.periodId,
      periodSettlements: 0,
      commitSequence: 0,
      completeNaturalPeriod: true,
      pendingCadence: null,
      pendingCadenceAt: null,
    },
    players: new Map(),
    optedOut: new Map(),
    lastPeriodRanking: null,
    honors: [],
    season: null,
    weekEvent: null,
  };
}

function shanghaiParts(ms) {
  const shifted = new Date(ms + 8 * HOUR);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function shanghaiDayId(ms) {
  const p = shanghaiParts(ms);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function refreshDailyUsage(player, kind, now) {
  const dayField = `${kind}DayId`;
  const countField = `${kind}DailyCount`;
  const dayId = shanghaiDayId(now);
  if (player[dayField] !== dayId) {
    player[dayField] = dayId;
    player[countField] = 0;
  } else if (!Number.isSafeInteger(player[countField]) || player[countField] < 0) {
    player[countField] = 0;
  }
  return player[countField];
}

function dailyUsageCount(player, kind, now) {
  return player[`${kind}DayId`] === shanghaiDayId(now) ? int(player[`${kind}DailyCount`], 0) : 0;
}

function shanghaiUtc(year, month, day) {
  return Date.UTC(year, month, day) - 8 * HOUR;
}

function isoWeekId(startAt) {
  const date = new Date(startAt + 8 * HOUR);
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDay);
  const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function periodBounds(ms, cadence) {
  const p = shanghaiParts(ms);
  if (cadence === 'month') {
    const startAt = shanghaiUtc(p.year, p.month, 1);
    const endAt = shanghaiUtc(p.year, p.month + 1, 1);
    return { startAt, endAt, periodId: `${p.year}-${String(p.month + 1).padStart(2, '0')}` };
  }
  const isoDay = p.weekday === 0 ? 7 : p.weekday;
  const startAt = shanghaiUtc(p.year, p.month, p.day - isoDay + 1);
  return { startAt, endAt: startAt + 7 * DAY, periodId: isoWeekId(startAt) };
}

function nextBoundary(ms, cadence) {
  return periodBounds(ms, cadence).endAt;
}

function isImmediatePrevious(board, meta, cadence) {
  if (!board || board.cadence !== cadence || !board.completeNaturalPeriod || meta.cadence !== cadence) return false;
  const expected = periodBounds(meta.periodStartAt - 1, cadence);
  return board.startAt === expected.startAt && board.endAt === expected.endAt;
}

function activePlayers(state) {
  return [...state.players.values()].filter((player) => !player.isolated && !state.optedOut.has(player.id));
}

function activePlayerCount(state) {
  return activePlayers(state).length;
}

function activeRecruitCount(state, player) {
  return player.recruits.filter((id) => {
    const recruit = state.players.get(id);
    return recruit && recruit.recruitedBy === player.id && !recruit.isolated && !state.optedOut.has(id);
  }).length;
}

function top(players, selector, limit = 5) {
  return [...players]
    .sort((a, b) => selector(b) - selector(a) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((player, index) => ({ playerId: player.id, rank: index + 1, value: selector(player), redacted: false }));
}

function settleDuePeriod(state, now, config) {
  const meta = state.meta;
  // A help-only/pristine ledger has no economy or ranking to settle. Apply the
  // configured cadence immediately so the first real game action starts in the
  // requested natural period instead of inheriting a stale rollout default.
  if (config.rankingPeriod !== meta.cadence && state.players.size === 0 && !state.lastPeriodRanking) {
    const bounds = periodBounds(now, config.rankingPeriod);
    meta.cadence = config.rankingPeriod;
    meta.periodStartAt = bounds.startAt;
    meta.periodEndAt = bounds.endAt;
    meta.periodId = bounds.periodId;
    meta.completeNaturalPeriod = true;
    meta.pendingCadence = null;
    meta.pendingCadenceAt = null;
    meta.noReset = Boolean(config.noReset);
    return true;
  }
  if (config.rankingPeriod !== meta.cadence && meta.pendingCadence !== config.rankingPeriod) {
    meta.pendingCadence = config.rankingPeriod;
    meta.pendingCadenceAt = periodBounds(now, config.rankingPeriod).endAt;
  } else if (config.rankingPeriod === meta.cadence) {
    meta.pendingCadence = null;
    meta.pendingCadenceAt = null;
  }
  const activatePendingCadence = Boolean(meta.pendingCadenceAt && now >= meta.pendingCadenceAt);
  const settlementAt = activatePendingCadence
    ? Math.min(meta.periodEndAt, meta.pendingCadenceAt)
    : meta.periodEndAt;
  if (now < settlementAt) {
    meta.noReset = Boolean(config.noReset);
    return false;
  }
  const players = activePlayers(state);
  const clearEconomy = !Boolean(config.noReset);
  state.lastPeriodRanking = {
    cadence: meta.cadence,
    periodId: meta.periodId,
    startAt: meta.periodStartAt,
    endAt: settlementAt,
    completeNaturalPeriod: Boolean(meta.completeNaturalPeriod) && settlementAt === meta.periodEndAt,
    cumulative: !clearEconomy,
    coins: top(players, (p) => p.coins),
    value: top(players, (p) => p.value),
    recruits: top(players, (p) => activeRecruitCount(state, p)),
    bank: top(players, (p) => p.bankBalance),
    seasonPoints: top(players, (p) => int(p.seasonPoints, 0)),
  };
  if (state.season && (!meta.completeNaturalPeriod || settlementAt !== meta.periodEndAt)) state.season.invalid = true;
  for (const player of state.players.values()) {
    if (clearEconomy) {
      player.buybackCount = 0;
      player.coins = 0;
      player.value = 100;
      player.recruitedBy = null;
      player.recruits = [];
      player.bankBalance = 0;
      player.bankLevel = 1;
      player.rating = 1000;
      player.workDayId = shanghaiDayId(now);
      player.workDailyCount = 0;
      player.trainDayId = player.trainedDayId = player.stealDayId = player.stealVictimDayId = shanghaiDayId(now);
      player.trainDailyCount = player.trainedDailyCount = player.stealDailyCount = player.stealVictimDailyCount = 0;
      player.duelDayId = shanghaiDayId(now);
      player.duelDailyCount = 0;
      player.rankDayId = player.rankParticipantDayId = shanghaiDayId(now);
      player.rankDailyCount = player.rankParticipantDailyCount = 0;
      player.lastWorkAt = player.lastTrainAt = player.lastStealAt = 0;
      player.lastDuelAt = player.lastRankAt = player.lastBuybackAt = 0;
      player.lastTrainedAt = player.lastRankParticipantAt = player.recruitLockedUntil = player.stealShieldUntil = 0;
      player.seasonPoints = 0;
      player.progressDayId = '';
      player.taskProgress = {};
      player.dailyPointCommands = [];
    }
  }
  meta.periodSettlements += 1;
  if (meta.pendingCadence && activatePendingCadence) {
    meta.cadence = meta.pendingCadence;
    meta.pendingCadence = null;
    meta.pendingCadenceAt = null;
  }
  meta.noReset = Boolean(config.noReset);
  const bounds = periodBounds(now, meta.cadence);
  meta.periodStartAt = bounds.startAt;
  meta.periodEndAt = bounds.endAt;
  meta.periodId = bounds.periodId;
  meta.completeNaturalPeriod = true;
  return true;
}

function detach(state, player) {
  if (player.recruitedBy) {
    const owner = state.players.get(player.recruitedBy);
    if (owner) owner.recruits = owner.recruits.filter((id) => id !== player.id);
  }
  for (const childId of player.recruits) {
    const child = state.players.get(childId);
    if (child && child.recruitedBy === player.id) child.recruitedBy = null;
  }
  player.recruitedBy = null;
  player.recruits = [];
}

function optOut(state, playerId, now, reason) {
  const existing = state.optedOut.get(playerId);
  if (existing) return existing;
  const marker = { playerId, reason, exitedAt: now, rejoinNotBefore: nextBoundary(now, state.meta.cadence) };
  const player = state.players.get(playerId);
  if (player) detach(state, player);
  state.players.delete(playerId);
  state.optedOut.set(playerId, marker);
  if (state.lastPeriodRanking) {
    for (const board of ['coins', 'value', 'recruits', 'bank', 'seasonPoints']) {
      for (const row of state.lastPeriodRanking[board] || []) {
        if (row.playerId === playerId) row.redacted = true;
      }
    }
  }
  if (state.weekEvent) {
    delete state.weekEvent.contributions?.[playerId];
    for (const key of Object.keys(state.weekEvent.participantDays || {})) {
      if (key.startsWith(`${playerId}:`)) delete state.weekEvent.participantDays[key];
    }
  }
  for (const season of state.honors || []) {
    for (const award of season.awards || []) if (award.playerId === playerId) award.redacted = true;
  }
  return marker;
}

function forceReset(state, now) {
  const players = activePlayers(state);
  state.lastPeriodRanking = {
    cadence: state.meta.cadence,
    periodId: state.meta.periodId,
    startAt: state.meta.periodStartAt,
    endAt: now,
    completeNaturalPeriod: false,
    cumulative: Boolean(state.meta.noReset),
    coins: top(players, (p) => p.coins),
    value: top(players, (p) => p.value),
    recruits: top(players, (p) => activeRecruitCount(state, p)),
    bank: top(players, (p) => p.bankBalance),
    seasonPoints: top(players, (p) => int(p.seasonPoints, 0)),
  };
  for (const player of state.players.values()) {
    player.coins = 0;
    player.value = 100;
    player.recruitedBy = null;
    player.recruits = [];
    player.bankBalance = 0;
    player.bankLevel = 1;
    player.rating = 1000;
    player.workDayId = shanghaiDayId(now);
    player.workDailyCount = 0;
    player.trainDayId = shanghaiDayId(now);
    player.trainDailyCount = 0;
    player.trainedDayId = shanghaiDayId(now);
    player.trainedDailyCount = 0;
    player.stealDayId = shanghaiDayId(now);
    player.stealDailyCount = 0;
    player.stealVictimDayId = shanghaiDayId(now);
    player.stealVictimDailyCount = 0;
    player.duelDayId = shanghaiDayId(now);
    player.duelDailyCount = 0;
    player.rankDayId = shanghaiDayId(now);
    player.rankDailyCount = 0;
    player.rankParticipantDayId = shanghaiDayId(now);
    player.rankParticipantDailyCount = 0;
    player.buybackCount = 0;
    player.lastWorkAt = player.lastTrainAt = player.lastStealAt = 0;
    player.lastDuelAt = player.lastRankAt = player.lastBuybackAt = 0;
    player.lastTrainedAt = player.lastRankParticipantAt = player.recruitLockedUntil = player.stealShieldUntil = 0;
    player.seasonPoints = 0;
    player.progressDayId = '';
    player.taskProgress = {};
    player.dailyPointCommands = [];
  }
  const bounds = periodBounds(now, state.meta.cadence);
  state.meta.periodStartAt = now;
  state.meta.periodEndAt = bounds.endAt;
  state.meta.periodId = `${bounds.periodId}-forced-${Number(state.meta.commitSequence || 0) + 1}`;
  state.meta.completeNaturalPeriod = false;
  state.meta.periodSettlements += 1;
  state.meta.pendingReset = null;
  if (state.season) state.season.invalid = true;
}

function reconcileMembers(state, snapshot, now) {
  if (!snapshot || snapshot.ok !== true || !snapshot.snapshotId || !Array.isArray(snapshot.members)) return false;
  const present = new Map(snapshot.members.map((member) => [String(member.username), sanitizeName(member.nickname)]));
  let changed = false;
  for (const player of [...state.players.values()]) {
    if (present.has(player.id)) {
      if (player.isolated || player.missingSnapshotId) changed = true;
      player.isolated = false;
      player.missingSnapshotId = null;
      player.missingAt = null;
      player.name = present.get(player.id) || player.name;
    } else if (!player.missingSnapshotId) {
      player.isolated = true;
      player.missingSnapshotId = String(snapshot.snapshotId);
      player.missingAt = now;
      changed = true;
    } else if (player.missingSnapshotId !== String(snapshot.snapshotId)
      && now - int(player.missingAt, now) >= MEMBER_ABSENCE_CONFIRM_DELAY) {
      optOut(state, player.id, player.missingAt || now, 'left_group');
      changed = true;
    }
  }
  return changed;
}

function ensurePlayer(state, request) {
  let player = state.players.get(request.senderId);
  if (!player) {
    player = initialPlayer(request.senderId, request.senderName, request.now);
    state.players.set(player.id, player);
  } else {
    player.name = sanitizeName(request.senderName || player.name);
  }
  return player;
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

const INTEREST_DENOMINATOR = 1000 * DAY;

function projectedInterest(player, now) {
  const lastInterestTime = int(player.lastInterestTime, now);
  const elapsed = Math.min(7 * DAY, Math.max(0, now - lastInterestTime));
  if (elapsed <= 0 || player.bankBalance <= 0) return { interest: 0, carry: int(player.bankInterestCarry, 0) };
  const principal = Math.min(40_000, player.bankBalance);
  // 0.5%/day, calculated by actual holding time. Integer carry prevents users
  // losing interest by performing frequent balance changes.
  const numerator = principal * 5 * elapsed + int(player.bankInterestCarry, 0);
  const interest = Math.min(Math.floor(numerator / INTEREST_DENOMINATOR), Math.floor(200 * elapsed / DAY));
  return { interest, carry: numerator - interest * INTEREST_DENOMINATOR };
}

function accrueInterest(player, now) {
  const projected = projectedInterest(player, now);
  if (projected.interest > 0) player.coins = checked(player.coins + projected.interest);
  player.bankInterestCarry = projected.carry;
  player.lastInterestTime = now;
  return projected.interest;
}

function bankLimit(level) { return Math.floor(1000 * (1.25 ** (level - 1))); }
function bankUpgradeCost(level) { return Math.floor(100 * (1.2 ** (level - 1))); }

function resolveTarget(state, targetId) {
  if (!targetId) return null;
  const target = state.players.get(targetId);
  return target && !target.isolated && !state.optedOut.has(targetId) ? target : null;
}

function wouldCycle(state, ownerId, targetId) {
  let cursor = state.players.get(ownerId);
  const visited = new Set();
  while (cursor && cursor.recruitedBy && !visited.has(cursor.id)) {
    if (cursor.recruitedBy === targetId) return true;
    visited.add(cursor.id);
    cursor = state.players.get(cursor.recruitedBy);
  }
  return false;
}

function listTargetCandidates(state, request) {
  const command = request.command;
  const members = Array.isArray(request.memberSnapshot?.members) ? request.memberSnapshot.members : [];
  const memberById = new Map(members.map((member) => [String(member.username), member]));
  const activity = request.lastSuccessfulAt || {};
  const protectedUsers = new Set((request.protectedUsers || []).map(String));
  const actor = state.players.get(request.senderId);
  let ids = [];

  if (command === 'train') {
    const owned = (actor?.recruits || []).filter((id) => {
      const target = resolveTarget(state, id);
      return target && memberById.has(id);
    });
    ids = owned.length ? owned : [request.senderId];
  } else if (command === 'release' || command === 'rank') {
    ids = (actor?.recruits || []).filter((id) => {
      const target = resolveTarget(state, id);
      return target && target.recruitedBy === request.senderId && memberById.has(id);
    });
  } else if (command === 'recruit') {
    if (protectedUsers.has(request.senderId)) return [];
    ids = members.map((member) => String(member.username)).filter((id) => {
      if (!id || id === request.senderId || protectedUsers.has(id) || state.optedOut.has(id)) return false;
      const target = state.players.get(id);
      if (target?.isolated || target?.recruitedBy === request.senderId) return false;
      return !target || !wouldCycle(state, request.senderId, id);
    });
  } else return [];

  return [...new Set(ids)].map((id) => {
    const member = memberById.get(id);
    const player = state.players.get(id);
    return {
      username: id,
      nickname: sanitizeName(member?.nickname || player?.name),
      lastSuccessfulAt: int(activity[id], 0),
    };
  }).sort((a, b) => b.lastSuccessfulAt - a.lastSuccessfulAt || a.username.localeCompare(b.username));
}

function ok(reply, extra = {}) { return { ok: true, code: 'ok', reply, mutated: true, ...extra }; }
function reject(code, reply) { return { ok: false, code, reply, mutated: false }; }

const NOTICE_TITLES = Object.freeze({
  join: '加入市场提示', status: '市场状态提示', ranking: '排行提示', 'last-ranking': '历史排行提示',
  'bank-upgrade': '银行升级提示', 'bank-deposit': '银行存款提示', 'bank-withdraw': '银行取款提示',
  work: '打工提示', recruit: '招募提示', release: '放生提示', train: '训练提示', steal: '夺取提示',
  buyback: '回购提示', duel: '决斗提示', rank: '排位提示',
});

function noticeCategory(command, code) {
  if (command === 'work' && code === 'cooldown') return 'work-cooldown';
  if (code === 'cooldown') return 'cooldown';
  if (code.endsWith('_daily_limit')) return 'daily-limit';
  if (['insufficient_funds', 'insufficient_bank', 'invalid_amount'].includes(code)) return 'insufficient';
  if (['target_unavailable', 'target_required', 'empty_target_pool', 'empty_target', 'empty_pool', 'no_history', 'wrong_period'].includes(code)) return 'target';
  if (['self_target', 'protected_target', 'protected_actor', 'already_owned', 'relationship_cycle', 'relationship_invalid', 'not_owned', 'not_recruited'].includes(code)) return 'relationship';
  if (['player_limit', 'bank_level_limit', 'bank_limit', 'buyback_limit'].includes(code)) return 'capacity';
  if (['rejoin_locked', 'opted_out', 'member_isolated'].includes(code)) return 'participation';
  return 'rule';
}

function playfulReject(request, code, factualReply) {
  const key = noticeCategory(request.command, code);
  const title = NOTICE_TITLES[request.command] || '操作提示';
  return reject(code, playfulNotice(request, key, title, `• ${factualReply}`));
}

function execute(state, request, config, random = Math.random) {
  const now = request.now;
  const priorSeasonId = state.season?.id;
  const priorEventId = state.weekEvent?.id;
  const membersReconciled = request.readOnly ? false : reconcileMembers(state, request.memberSnapshot, now);
  const periodSettled = request.readOnly ? false : settleDuePeriod(state, now, config);
  if (!request.readOnly) ensureProgressionPeriods(state, now, true);
  const progressionRolled = !request.readOnly && (priorSeasonId !== state.season?.id || priorEventId !== state.weekEvent?.id);
  let systemMutation = progressionRolled || membersReconciled || periodSettled;
  const command = request.command;
  const marker = state.optedOut.get(request.senderId);

  if (command === 'market-version') {
    return { ...ok([
      `🎮 小米粒群友市场 ${MARKET_VERSION}`,
      `规则：${RULESET_VERSION}｜内容：${CONTENT_VERSION}｜账本：${CURRENT_SCHEMA_VERSION}`,
      `规则指纹：${RULESET_HASH.slice(0, 12)}`,
      `赛季：${state.season?.id || periodBounds(now, 'month').periodId}｜${state.meta.noReset ? '不清零' : '结算清零'}`,
    ].join('\n')), mutated: systemMutation };
  }
  if (marker && ['market-records', 'market-tasks', 'market-achievements', 'market-honors', 'market-event'].includes(command)) {
    return { ...ok('你已退出小米粒群友市场，个人记录与进度已清除。'), mutated: systemMutation };
  }
  if (command === 'market-records') {
    const history = Array.isArray(request.operationHistory) ? request.operationHistory.slice(0, 10) : [];
    const lines = history.map((item, index) => {
      const time = Number.isSafeInteger(item?.at || item?.createdAt || item?.timestamp) ? formatShanghai(item.at || item.createdAt || item.timestamp) : '时间未知';
      const action = sanitizeName(item?.command || item?.operation || item?.type || '操作');
      const result = sanitizeName(item?.code || item?.result || 'ok');
      return `${index + 1}. ${time}｜${action}｜${result}`;
    });
    return { ...ok(`🧾 最近市场记录\n${lines.join('\n') || '暂无成功操作记录。'}`), mutated: systemMutation };
  }
  if (command === 'market-tasks') return { ...ok(taskText(state.players.get(request.senderId), now)), mutated: systemMutation };
  if (command === 'market-achievements') return { ...ok(achievementText(state.players.get(request.senderId))), mutated: systemMutation };
  if (command === 'market-honors') return { ...ok(honorText(state, request.senderId)), mutated: systemMutation };
  if (command === 'market-event') return { ...ok(eventText(state, now)), mutated: systemMutation };

  if (command === 'help') return { ...ok(marketHelpText(state.meta.cadence, state.meta.noReset)), mutated: systemMutation };
  if (command === 'exit') {
    const saved = optOut(state, request.senderId, now, 'voluntary');
    return ok(playfulReply(request, 'exit', `• 状态：已退出市场\n• 可重新加入：北京时间 ${formatShanghai(saved.rejoinNotBefore)}\n• 加入指令：@小米粒 #加入市场`));
  }
  if (command === 'join') {
    if (marker && now < marker.rejoinNotBefore) return { ...playfulReject(request, 'rejoin_locked', `暂不能加入，可加入时间：北京时间 ${formatShanghai(marker.rejoinNotBefore)}`), mutated: systemMutation };
    if (!state.players.has(request.senderId) && activePlayerCount(state) >= config.maxPlayersPerGroup) {
      return { ...playfulReject(request, 'player_limit', '本群活跃玩家数已达上限。'), mutated: systemMutation };
    }
    if (marker) state.optedOut.delete(request.senderId);
    const player = ensurePlayer(state, request);
    return ok(playfulReply(request, 'join', `• 状态：已加入\n• 虚拟币：${player.coins}\n• 身价：${player.value}`));
  }
  if (command === 'status') {
    const player = state.players.get(request.senderId);
    if (marker) return { ...ok(playfulReply(request, 'status', `• 状态：已退出市场\n• 可重新加入：北京时间 ${formatShanghai(marker.rejoinNotBefore)}`)), mutated: systemMutation };
    const relationship = player
      ? `招募方 ${resolveTarget(state, player.recruitedBy) ? '有' : '无'}，名下群友 ${activeRecruitCount(state, player)}`
      : '尚未建卡';
    const recent = request.recentOperation?.transactionId
      ? `；最近交易 ${request.recentOperation.transactionId}（${request.recentOperation.code || 'ok'}）`
      : '';
    const statusLines = [
      `• 赛制：${state.meta.cadence === 'month' ? '月榜' : '周榜'}｜${state.meta.noReset ? '不清零' : '结算清零'}`,
      player ? `• 资产：虚拟币 ${player.coins}｜身价 ${player.value}｜银行 ${player.bankBalance}` : `• 状态：${relationship}`,
      player ? `• 关系：${relationship}` : null,
      player ? `• 本月积分：${int(player.seasonPoints, 0)}｜展示票券：${int(player.cosmeticTickets, 0)}` : null,
      player ? `• 今日次数：打工 ${dailyUsageCount(player, 'work', now)}/${WORK_DAILY_LIMIT}｜训练 ${dailyUsageCount(player, 'train', now)}/3｜夺取 ${dailyUsageCount(player, 'steal', now)}/5｜决斗 ${dailyUsageCount(player, 'duel', now)}/10｜排位 ${dailyUsageCount(player, 'rank', now)}/5` : null,
      recent ? `• ${recent.replace(/^；/, '')}` : null,
    ].filter(Boolean);
    return { ...ok(playfulReply(request, 'status', statusLines.join('\n'))), mutated: systemMutation };
  }
  if (marker) return { ...playfulReject(request, 'opted_out', `你已退出市场，可加入时间：北京时间 ${formatShanghai(marker.rejoinNotBefore)}`), mutated: systemMutation };

  if (command === 'ranking') {
    const liveIds = request.memberSnapshot?.ok === true && Array.isArray(request.memberSnapshot.members)
      ? new Set(request.memberSnapshot.members.map((member) => String(member.username))) : null;
    const players = activePlayers(state).filter((candidate) => !liveIds || liveIds.has(candidate.id));
    const visibleRecruitCount = (candidate) => candidate.recruits.filter((id) => (!liveIds || liveIds.has(id))
      && resolveTarget(state, id)?.recruitedBy === candidate.id).length;
    const boards = [
      ['虚拟币', (p) => p.coins], ['身价', (p) => p.value],
      ['群友数', visibleRecruitCount], ['银行', (p) => p.bankBalance],
      ['月积分', (p) => int(p.seasonPoints, 0)],
    ];
    const text = boards.map(([label, selector]) => {
      const ordered = [...players].sort((a, b) => selector(b) - selector(a) || a.id.localeCompare(b.id));
      const rows = ordered.slice(0, 15).map((p, index) => `${index + 1}. ${p.name} ${selector(p)}`);
      const ownIndex = ordered.findIndex((p) => p.id === request.senderId);
      return `${label}榜\n${rows.join('\n') || '暂无数据'}${ownIndex >= 15 ? `\n我的名次：${ownIndex + 1}` : ''}`;
    }).join('\n\n');
    return { ...ok(playfulReply(request, 'ranking', `统计口径：累计资产 + 当月积分（排行读取按本次可信群成员快照临时过滤）\n\n${text}`)), mutated: systemMutation };
  }
  if (command === 'last-ranking') {
    const board = state.lastPeriodRanking;
    if (!board) return { ...playfulReject(request, 'no_history', '暂无历史排行。'), mutated: systemMutation };
    if (request.requestedRanking === '上周排行' && !isImmediatePrevious(board, state.meta, 'week')) {
      return { ...playfulReject(request, 'wrong_period', '当前没有可作为上周展示的完整周榜，请用“上期排行”。'), mutated: systemMutation };
    }
    if (request.requestedRanking === '上月排行' && !isImmediatePrevious(board, state.meta, 'month')) {
      return { ...playfulReject(request, 'wrong_period', '当前没有可作为上月展示的完整月榜，请用“上期排行”。'), mutated: systemMutation };
    }
    const labels = { coins: '虚拟币', value: '身价', recruits: '群友数', bank: '银行', seasonPoints: '月积分' };
    const liveIds = request.memberSnapshot?.ok === true && Array.isArray(request.memberSnapshot.members)
      ? new Set(request.memberSnapshot.members.map((member) => String(member.username))) : null;
    const rows = Object.keys(labels).map((key) => {
      const lines = (board[key] || []).filter((row) => !liveIds || liveIds.has(row.playerId))
        .map((row, index) => `${index + 1}. ${row.redacted ? '已退出群友' : (state.players.get(row.playerId)?.name || '群友')} ${row.value}`);
      return `${labels[key]}榜\n${lines.join('\n') || '暂无数据'}`;
    }).join('\n\n');
    const range = `北京时间 ${formatShanghai(board.startAt)} 至 ${formatShanghai(board.endAt)}`;
    return { ...ok(playfulReply(request, 'last-ranking', `${board.periodId}（${range}）${board.cumulative ? ' 期末累计快照' : ''}\n${rows}`)), mutated: systemMutation };
  }
  if (command.startsWith('admin-reset')) {
    if (!request.adminUsers?.includes(request.senderId)) return { ...reject('admin_required', '仅市场管理员可执行此指令。'), mutated: systemMutation };
    if (command === 'admin-reset-status') {
      const pending = state.meta.pendingReset;
      return { ...ok(pending && pending.expiresAt > now ? `强制重置待确认，确认码 #${pending.token}。` : '当前没有待确认的强制重置。'), mutated: systemMutation };
    }
    if (command === 'admin-reset') return { ...ok(periodSettled ? '已补做应到期的周期结算。' : '当前没有应补做的周期结算。'), mutated: systemMutation };
    if (command === 'admin-reset-force') {
      state.meta.pendingReset = {
        token: request.confirmationToken,
        adminId: request.senderId,
        expiresAt: now + 300_000,
        periodId: state.meta.periodId,
        commitSequence: Number(state.meta.commitSequence || 0) + 1,
      };
      return ok(`强制重置会立即清空当前周期。请在 5 分钟内发送“市场重置 确认 #${request.confirmationToken}”。`);
    }
    const pending = state.meta.pendingReset;
    if (!pending || pending.expiresAt <= now || pending.adminId !== request.senderId || pending.token !== request.resetToken) {
      return { ...reject('reset_confirmation_invalid', '确认码无效或已过期。'), mutated: systemMutation };
    }
    if (pending.periodId !== state.meta.periodId
      || pending.commitSequence !== Number(state.meta.commitSequence || 0)
      || membersReconciled || periodSettled) {
      state.meta.pendingReset = null;
      return { ...reject('reset_state_changed', '市场状态已变化，确认码已作废，请重新发起强制重置。'), mutated: true };
    }
    forceReset(state, now);
    return ok('当前周期已强制结算并清空。');
  }

  if (command === 'bank-status') {
    const bankPlayer = state.players.get(request.senderId);
    const bankBalance = bankPlayer?.bankBalance || 0;
    const pendingInterest = bankPlayer ? projectedInterest(bankPlayer, now).interest : 0;
    const bankLevel = bankPlayer?.bankLevel || 1;
    return { ...ok(playfulReply(request, 'bank-status', `• 银行本金：${bankBalance}\n• 待结利息：${pendingInterest}（结息进入现金）\n• 存款限额：${bankLimit(bankLevel)}\n• 银行等级：${bankLevel}`)), mutated: systemMutation };
  }
  if (!state.players.has(request.senderId) && activePlayerCount(state) >= config.maxPlayersPerGroup) {
    return { ...playfulReject(request, 'player_limit', '本群活跃玩家数已达上限。'), mutated: systemMutation };
  }
  const player = ensurePlayer(state, request);
  const completeProgress = (action, outcome) => {
    const progress = recordSuccessfulAction(state, player, action, now, outcome);
    checked(player.coins);
    return progress;
  };
  if (player.isolated) return { ...playfulReject(request, 'member_isolated', '成员状态待确认，暂不能操作。'), mutated: systemMutation };
  if (request.protectedUsers?.includes(player.id) && ['recruit', 'steal'].includes(command)) {
    return playfulReject(request, 'protected_actor', '受保护玩家不能参与该操作。');
  }

  if (command === 'work') {
    const workToday = refreshDailyUsage(player, 'work', now);
    if (workToday >= WORK_DAILY_LIMIT) return playfulReject(request, 'work_daily_limit', `今日已打工 ${workToday} 次，上限 ${WORK_DAILY_LIMIT} 次；北京时间明日 00:00 后恢复。`);
    if (now - player.lastWorkAt < WORK_COOLDOWN_MS) {
      const remaining = WORK_COOLDOWN_MS - (now - player.lastWorkAt);
      return playfulReject(request, 'cooldown', `打工冷却中，剩余 ${remainingTimeText(remaining)}。`);
    }
    const recruits = activeRecruitCount(state, player);
    const recruitBonusPercent = recruits === 0 ? 0 : Math.min(30, 15 + (recruits - 1) * 5);
    const raw = randomInt(random, 40, 80) + Math.min(20, Math.floor(player.value / 100));
    const gain = Math.floor(raw * (100 + recruitBonusPercent) / 100);
    player.coins = checked(player.coins + gain);
    player.lastWorkAt = now;
    player.workDailyCount += 1;
    const progress = completeProgress('work');
    return ok(playfulReply(request, 'work', `• 本次获得：${gain} 虚拟币${progress.taskBonus ? `\n• 今日任务奖励：${progress.taskBonus} 虚拟币` : ''}\n• 当前余额：${player.coins} 虚拟币\n• 今日次数：${player.workDailyCount}/${WORK_DAILY_LIMIT}\n• 本月积分：${player.seasonPoints}`));
  }

  if (command === 'bank-upgrade') {
    accrueInterest(player, now);
    if (player.bankLevel >= 100) return playfulReject(request, 'bank_level_limit', '银行等级已达上限。');
    const cost = bankUpgradeCost(player.bankLevel);
    if (player.coins < cost) return playfulReject(request, 'insufficient_funds', `升级需要 ${cost} 虚拟币。`);
    player.coins -= cost; player.bankLevel += 1;
    completeProgress('bank-upgrade');
    return ok(playfulReply(request, 'bank-upgrade', `• 当前等级：${player.bankLevel}\n• 存款限额：${bankLimit(player.bankLevel)}\n• 本次花费：${cost} 虚拟币`));
  }
  if (command === 'bank-deposit' || command === 'bank-withdraw') {
    accrueInterest(player, now);
    const all = request.amount === 'all';
    const amount = all ? (command === 'bank-deposit' ? player.coins : player.bankBalance) : Number(request.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) return playfulReject(request, 'invalid_amount', '金额须为正整数或“全部”。');
    if (command === 'bank-deposit') {
      if (amount > player.coins) return playfulReject(request, 'insufficient_funds', '虚拟币不足。');
      if (player.bankBalance + amount > bankLimit(player.bankLevel)) return playfulReject(request, 'bank_limit', '超过银行限额。');
      player.coins -= amount; player.bankBalance += amount;
    } else {
      if (amount > player.bankBalance) return playfulReject(request, 'insufficient_bank', '银行余额不足。');
      player.bankBalance -= amount; player.coins = checked(player.coins + amount);
    }
    completeProgress(command);
    return ok(playfulReply(request, command, `• 本次${command === 'bank-deposit' ? '存入' : '取出'}：${amount} 虚拟币\n• 现金余额：${player.coins}\n• 银行余额：${player.bankBalance}`));
  }

  let target = resolveTarget(state, request.targetId);
  if (command === 'recruit' && !target && request.targetId && request.targetName) {
    if (state.optedOut.has(request.targetId) || state.players.has(request.targetId)) {
      return playfulReject(request, 'target_unavailable', '目标不存在或当前不可操作。');
    }
    if (activePlayerCount(state) >= config.maxPlayersPerGroup) return playfulReject(request, 'player_limit', '本群活跃玩家数已达上限。');
    target = initialPlayer(request.targetId, request.targetName, now);
    state.players.set(target.id, target);
  }
  if (command === 'train' && !request.targetId) {
    const owned = player.recruits.map((id) => resolveTarget(state, id)).filter(Boolean);
    if (owned.length === 0) target = player;
    else if (owned.length === 1) target = owned[0];
    else return playfulReject(request, 'target_required', '你有多名群友，请指定训练对象。');
  }
  if (command === 'steal' && request.randomTarget) {
    const pool = activePlayers(state).filter((candidate) => candidate.id !== player.id
      && candidate.coins >= 10 && now >= int(candidate.stealShieldUntil, 0)
      && dailyUsageCount(candidate, 'stealVictim', now) < 2
      && !request.protectedUsers?.includes(candidate.id));
    target = pool.length ? pool[randomInt(random, 0, pool.length - 1)] : null;
  }
  if (command === 'steal' && request.randomTarget && !target) {
    return playfulReject(request, 'empty_target_pool', '当前没有可夺取的其他群友，先等大家赚点钱再来。');
  }
  if (['recruit', 'release', 'train', 'steal', 'rank'].includes(command) && !target) return playfulReject(request, 'target_unavailable', '目标不存在或当前不可操作。');
  if (target && target.id === player.id && command !== 'train') return playfulReject(request, 'self_target', '不能操作自己。');

  if (command === 'recruit') {
    if (request.protectedUsers?.includes(target.id)) return playfulReject(request, 'protected_target', '该目标不可招募。');
    if (target.recruitedBy === player.id) return playfulReject(request, 'already_owned', '对方已是你的群友。');
    if (wouldCycle(state, player.id, target.id)) return playfulReject(request, 'relationship_cycle', '该操作会形成循环关系。');
    if (now < int(target.recruitLockedUntil, 0)) return playfulReject(request, 'cooldown', `该群友暂不可再次招募，剩余 ${remainingTimeText(target.recruitLockedUntil - now)}。`);
    const price = target.value;
    if (player.coins < price) return playfulReject(request, 'insufficient_funds', `招募需要 ${price} 虚拟币。`);
    const oldOwner = target.recruitedBy ? state.players.get(target.recruitedBy) : null;
    if (target.recruitedBy && (!oldOwner || oldOwner.isolated || state.optedOut.has(oldOwner.id))) {
      return playfulReject(request, 'relationship_invalid', '原招募方当前不可交易，请稍后再试。');
    }
    player.coins -= price;
    if (target.recruitedBy) {
      const ownerShare = Math.floor(price * 0.85);
      const targetShare = Math.floor(price * 0.10);
      oldOwner.coins = checked(oldOwner.coins + ownerShare);
      oldOwner.recruits = oldOwner.recruits.filter((id) => id !== target.id);
      target.coins = checked(target.coins + targetShare);
    } else target.coins = checked(target.coins + Math.floor(price * 0.95));
    target.recruitedBy = player.id;
    if (!player.recruits.includes(target.id)) player.recruits.push(target.id);
    target.value = checked(target.value + 5);
    target.recruitLockedUntil = now + HOUR;
    completeProgress('recruit');
    return ok(playfulReply(request, 'recruit', `• 状态：招募成功\n• 支付：${price} 虚拟币\n• 当前余额：${player.coins} 虚拟币`));
  }
  if (command === 'release') {
    if (target.recruitedBy !== player.id) return playfulReject(request, 'not_owned', '对方不属于你。');
    target.recruitedBy = null; player.recruits = player.recruits.filter((id) => id !== target.id);
    target.recruitLockedUntil = now + HOUR;
    completeProgress('release');
    return ok(playfulReply(request, 'release', `• 状态：已放生\n• 对象：${target.name}`));
  }
  if (command === 'train') {
    if (target.id !== player.id && target.recruitedBy !== player.id) return playfulReject(request, 'not_owned', '只能训练自己或本人名下群友。');
    if (refreshDailyUsage(player, 'train', now) >= 3) return playfulReject(request, 'train_daily_limit', '今日施训次数已用完（3/3）。');
    if (refreshDailyUsage(target, 'trained', now) >= 3) return playfulReject(request, 'trained_daily_limit', '该群友今日受训次数已用完（3/3）。');
    if (now - player.lastTrainAt < 2 * HOUR) return playfulReject(request, 'cooldown', `训练冷却中，剩余 ${remainingTimeText(2 * HOUR - (now - player.lastTrainAt))}。`);
    if (now - target.lastTrainedAt < 2 * HOUR) return playfulReject(request, 'cooldown', `该群友受训冷却中，剩余 ${remainingTimeText(2 * HOUR - (now - target.lastTrainedAt))}。`);
    const cost = Math.max(10, Math.min(100, Math.floor(target.value * 0.1)));
    if (player.coins < cost) return playfulReject(request, 'insufficient_funds', `训练需要 ${cost} 虚拟币。`);
    player.coins -= cost; player.lastTrainAt = now; player.trainDailyCount += 1;
    target.lastTrainedAt = now; target.trainedDailyCount += 1;
    const success = random() < 0.7;
    if (success) target.value = checked(target.value + Math.max(5, Math.min(20, Math.floor(target.value * 0.05))));
    const progress = completeProgress('train', { won: success });
    return ok(playfulReply(request, success ? 'train-success' : 'train-fail', `• 结果：${success ? '训练成功' : '训练失败'}\n• 对象：${target.name}\n• 花费：${cost} 虚拟币${progress.taskBonus ? `\n• 今日任务奖励：${progress.taskBonus} 虚拟币` : ''}\n• 当前身价：${target.value}\n• 今日施训：${player.trainDailyCount}/3`));
  }
  if (command === 'steal') {
    if (request.protectedUsers?.includes(target.id)) return playfulReject(request, 'protected_target', '该目标不可夺取。');
    if (refreshDailyUsage(player, 'steal', now) >= 5) return playfulReject(request, 'steal_daily_limit', '今日夺取次数已用完（5/5）。');
    if (now - player.lastStealAt < 600_000) return playfulReject(request, 'cooldown', `夺取冷却中，剩余 ${remainingTimeText(600_000 - (now - player.lastStealAt))}。`);
    if (player.coins < 20) return playfulReject(request, 'insufficient_funds', '夺取至少需要持有 20 虚拟币。');
    if (target.coins < 10) return playfulReject(request, 'empty_target', '目标至少需要持有 10 虚拟币。');
    if (now < int(target.stealShieldUntil, 0)) return playfulReject(request, 'cooldown', `目标处于夺取保护中，剩余 ${remainingTimeText(target.stealShieldUntil - now)}。`);
    if (refreshDailyUsage(target, 'stealVictim', now) >= 2) return playfulReject(request, 'steal_victim_daily_limit', '该目标今日已被成功夺取 2 次。');
    player.lastStealAt = now; player.stealDailyCount += 1;
    if (random() < 0.3) {
      const gain = Math.min(Math.floor(target.coins * 0.1), 100);
      target.coins -= gain; player.coins = checked(player.coins + gain);
      target.stealShieldUntil = now + 2 * HOUR; target.stealVictimDailyCount += 1;
      completeProgress('steal');
      return ok(playfulReply(request, 'steal-success', `• 结果：夺取成功\n• 本次获得：${gain} 虚拟币\n• 当前余额：${player.coins} 虚拟币\n• 今日次数：${player.stealDailyCount}/5`));
    }
    player.coins -= 20;
    completeProgress('steal');
    return ok(playfulReply(request, 'steal-fail', `• 结果：夺取失败\n• 本次损失：20 虚拟币\n• 当前余额：${player.coins} 虚拟币\n• 今日次数：${player.stealDailyCount}/5`));
  }
  if (command === 'buyback') {
    if (!player.recruitedBy) return playfulReject(request, 'not_recruited', '你当前未被招募。');
    const buybackMonthId = periodBounds(now, 'month').periodId;
    if (player.buybackMonthId !== buybackMonthId) { player.buybackMonthId = buybackMonthId; player.buybackCount = 0; }
    if (player.buybackCount >= 3) return playfulReject(request, 'buyback_limit', '本周期回购次数已用完。');
    if (now - player.lastBuybackAt < DAY) return playfulReject(request, 'cooldown', `回购冷却中，剩余 ${remainingTimeText(DAY - (now - player.lastBuybackAt))}。`);
    const owner = state.players.get(player.recruitedBy);
    if (!owner || owner.isolated || state.optedOut.has(owner.id)) return playfulReject(request, 'relationship_invalid', '招募方当前不可交易，已停止回购。');
    const price = 2 * player.value; const tax = Math.floor(price * 0.05);
    if (player.coins < price + tax) return playfulReject(request, 'insufficient_funds', `回购需要 ${price + tax} 虚拟币。`);
    player.coins -= price + tax; owner.coins = checked(owner.coins + price);
    owner.recruits = owner.recruits.filter((id) => id !== player.id); player.recruitedBy = null;
    player.value = checked(player.value + 5); player.buybackCount += 1; player.lastBuybackAt = now; player.recruitLockedUntil = now + HOUR;
    completeProgress('buyback');
    return ok(playfulReply(request, 'buyback', `• 状态：回购成功\n• 回购金额：${price} 虚拟币\n• 税费：${tax} 虚拟币\n• 当前余额：${player.coins} 虚拟币`));
  }
  if (command === 'duel') {
    if (refreshDailyUsage(player, 'duel', now) >= 10) return playfulReject(request, 'duel_daily_limit', '今日决斗次数已用完（10/10），北京时间明日 00:00 后恢复。');
    if (now - player.lastDuelAt < 3 * 60_000) return playfulReject(request, 'cooldown', `决斗冷却中，剩余 ${remainingTimeText(3 * 60_000 - (now - player.lastDuelAt))}。`);
    const pool = activePlayers(state).filter((p) => p.id !== player.id);
    if (!pool.length) return playfulReject(request, 'empty_pool', '暂无可决斗对象。');
    if (player.coins < 10) return playfulReject(request, 'insufficient_funds', '决斗入场需要 10 虚拟币。');
    const opponent = pool[randomInt(random, 0, pool.length - 1)];
    player.coins -= 10; player.lastDuelAt = now; player.duelDailyCount += 1;
    const won = random() < 0.5;
    if (won) {
      player.coins = checked(player.coins + 15);
      player.value = checked(player.value + 2);
      player.rating = checked(player.rating + 2);
    }
    const progress = completeProgress('duel', { won });
    return ok(playfulReply(request, won ? 'duel-win' : 'duel-loss', `• 结果：${won ? '获胜' : '失败'}\n• 对手：${opponent.name}\n• 入场：10 虚拟币${won ? '\n• 胜利返还：15 虚拟币' : ''}${progress.taskBonus ? `\n• 今日任务奖励：${progress.taskBonus} 虚拟币` : ''}\n• 当前余额：${player.coins} 虚拟币\n• 今日次数：${player.duelDailyCount}/10`));
  }
  if (command === 'rank') {
    if (target.recruitedBy !== player.id) return playfulReject(request, 'not_owned', '只能让本人名下且仍在群的群友排位。');
    if (refreshDailyUsage(player, 'rank', now) >= 5) return playfulReject(request, 'rank_daily_limit', '今日发起排位次数已用完（5/5）。');
    if (refreshDailyUsage(target, 'rankParticipant', now) >= 5) return playfulReject(request, 'rank_participant_daily_limit', '该群友今日排位次数已用完（5/5）。');
    if (now - player.lastRankAt < HOUR) return playfulReject(request, 'cooldown', `排位冷却中，剩余 ${remainingTimeText(HOUR - (now - player.lastRankAt))}。`);
    if (now - target.lastRankParticipantAt < HOUR) return playfulReject(request, 'cooldown', `该群友排位冷却中，剩余 ${remainingTimeText(HOUR - (now - target.lastRankParticipantAt))}。`);
    const opponentRating = Math.max(0, target.rating + randomInt(random, -300, 300));
    const expected = 1 / (1 + (10 ** ((opponentRating - target.rating) / 400)));
    const won = random() < expected;
    const delta = Math.round(32 * ((won ? 1 : 0) - expected));
    target.rating = checked(Math.max(0, target.rating + delta));
    const reward = won ? 20 : 0;
    player.coins = checked(player.coins + reward);
    player.lastRankAt = now; player.rankDailyCount += 1;
    target.lastRankParticipantAt = now; target.rankParticipantDailyCount += 1;
    completeProgress('rank');
    return ok(playfulReply(request, won ? 'rank-win' : 'rank-loss', `• 结果：${won ? '获胜' : '失利'}\n• 参赛群友：${target.name}\n• 当前积分：${target.rating}\n• 奖励：${reward} 虚拟币\n• 今日次数：${player.rankDailyCount}/5`));
  }
  return reject('not_implemented', '该指令暂未实现。');
}

function validateState(state) {
  if (!state?.meta || !['week', 'month'].includes(state.meta.cadence)
    || state.meta.schemaVersion !== CURRENT_SCHEMA_VERSION
    || !Number.isSafeInteger(state.meta.periodStartAt) || !Number.isSafeInteger(state.meta.periodEndAt)
    || state.meta.periodEndAt <= state.meta.periodStartAt) throw new Error('invalid_market_meta');
  for (const player of state.players.values()) {
    if (state.optedOut.has(player.id)) throw new Error('player_opted_out_overlap');
    for (const field of ['coins', 'value', 'bankBalance', 'bankLevel', 'rating', 'buybackCount', 'seasonPoints', 'cosmeticTickets', 'bankInterestCarry']) {
      if (!Number.isSafeInteger(player[field]) || player[field] < 0 || player[field] > MAX_SAFE_AMOUNT) throw new Error(`invalid_player_${field}`);
    }
    if (player.bankLevel > 100) throw new Error('invalid_player_bankLevel');
    for (const field of ['lastInterestTime', 'lastWorkAt', 'lastTrainAt', 'lastTrainedAt', 'lastStealAt', 'stealShieldUntil', 'lastDuelAt', 'lastRankAt', 'lastRankParticipantAt', 'lastBuybackAt', 'recruitLockedUntil']) {
      if (!Number.isSafeInteger(player[field]) || player[field] < 0) throw new Error(`invalid_player_${field}`);
    }
    for (const field of ['workDailyCount', 'trainDailyCount', 'trainedDailyCount', 'stealDailyCount', 'stealVictimDailyCount', 'duelDailyCount', 'rankDailyCount', 'rankParticipantDailyCount']) {
      if (player[field] !== undefined && (!Number.isSafeInteger(player[field]) || player[field] < 0)) throw new Error(`invalid_player_${field}`);
    }
    for (const field of ['workDayId', 'trainDayId', 'trainedDayId', 'stealDayId', 'stealVictimDayId', 'duelDayId', 'rankDayId', 'rankParticipantDayId']) {
      if (player[field] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(player[field])) throw new Error(`invalid_player_${field}`);
    }
    if (player.recruitedBy) {
      const owner = state.players.get(player.recruitedBy);
      if (!owner || !owner.recruits.includes(player.id)) throw new Error('relationship_inconsistent');
    }
    for (const childId of player.recruits) {
      const child = state.players.get(childId);
      if (!child || child.recruitedBy !== player.id) throw new Error('relationship_inconsistent');
    }
    if (wouldCycle(state, player.id, player.id)) throw new Error('relationship_cycle');
  }
  for (const marker of state.optedOut.values()) {
    if (!marker || typeof marker.playerId !== 'string' || !Number.isSafeInteger(marker.exitedAt)
      || !Number.isSafeInteger(marker.rejoinNotBefore) || marker.rejoinNotBefore < marker.exitedAt) throw new Error('invalid_opted_out_marker');
  }
  return true;
}

module.exports = {
  CONTENT_VERSION,
  CURRENT_SCHEMA_VERSION,
  DAY,
  HOUR,
  MARKET_VERSION,
  RULESET,
  RULESET_HASH,
  RULESET_VERSION,
  emptyState,
  execute,
  initialPlayer,
  nextBoundary,
  noticeLinesFor,
  periodBounds,
  playfulLinesFor,
  reconcileMembers,
  marketHelpText,
  listTargetCandidates,
  sanitizeName,
  upgradeState,
  validateState,
};
