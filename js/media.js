/** 媒体系统：通稿、赛后、转会、传闻 */

const OUTLETS = [
  { id: "vc_sport", name: "VC体育", bias: 0 },
  { id: "league_daily", name: "联赛日报", bias: 0 },
  { id: "midnight", name: "午夜足球", bias: -0.1 },
  { id: "fan_voice", name: "球迷之声", bias: 0.15 },
  { id: "transfer_wire", name: "转会电报", bias: 0 },
  { id: "tactician", name: "战术板", bias: 0.05 },
  { id: "gossip", name: "更衣室八卦", bias: -0.2 },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function ensureMedia(world) {
  if (!Array.isArray(world.media)) world.media = [];
  return world.media;
}

export function pushMedia(world, article) {
  ensureMedia(world);
  const full = {
    id: uid(),
    day: world.day,
    season: world.season,
    outlet: article.outlet || pick(OUTLETS).name,
    headline: article.headline,
    body: article.body || "",
    tone: article.tone || "neutral", // positive | neutral | negative | rumor
    category: article.category || "general",
  };
  world.media.unshift(full);
  if (world.media.length > 80) world.media.length = 80;

  // 同步一条简讯到 news（概览）
  const icon =
    full.tone === "positive" ? "📰" :
    full.tone === "negative" ? "📢" :
    full.tone === "rumor" ? "👂" : "🗞";
  world.news.unshift({
    day: world.day,
    text: `${icon} [${full.outlet}] ${full.headline}`,
    mediaId: full.id,
  });
  if (world.news.length > 60) world.news.length = 60;

  return full;
}

function outletByCategory(cat) {
  if (cat === "transfer") return "转会电报";
  if (cat === "tactics") return "战术板";
  if (cat === "rumor") return pick(["更衣室八卦", "午夜足球"]);
  if (cat === "fan") return "球迷之声";
  return pick(["VC体育", "联赛日报", "午夜足球"]);
}

/** 用户比赛后通稿 */
export function mediaAfterUserMatch(world, fixture, userClub, opp, myG, opG) {
  let tone = "neutral";
  let headline = "";
  let body = "";

  if (myG > opG) {
    tone = "positive";
    const margins = myG - opG;
    if (margins >= 3) {
      headline = `${userClub.name} ${myG}-${opG} 血洗${opp.name}，媒体盛赞“降维打击”`;
      body = `${userClub.short}在主客场对决中以大比分击败${opp.name}。记者写道：“这是一场教科书式的胜利，更衣室士气沸腾。”球迷之声评论区已被庆祝表情刷屏。`;
    } else {
      headline = `${userClub.name} ${myG}-${opG} 力克${opp.name}，积分榜再进一步`;
      body = `比赛过程紧凑。赛后主教练接受简短采访时表示：“三分最重要，细节还有提升空间。”${pick(OUTLETS).name}认为此役有助于巩固排名目标。`;
    }
  } else if (myG < opG) {
    tone = "negative";
    headline = `${userClub.name} ${myG}-${opG} 不敌${opp.name}，赛后质疑声四起`;
    body = `失利后看台响起零星嘘声。《午夜足球》评论：“今天的防守漏洞足以写进反面教材。”也有分析认为只需微调即可反弹，不必过度解读单场结果。`;
  } else {
    tone = "neutral";
    headline = `${userClub.name} ${myG}-${opG} 战平${opp.name}，双方握手言和`;
    body = `一场火药味不足的平局。双方都有得分机会，却都欠临门一脚。联赛日报给出评价：“像一杯温水——不难喝，但也不过瘾。”`;
  }

  pushMedia(world, {
    outlet: outletByCategory("match"),
    headline,
    body,
    tone,
    category: "match",
  });

  // 额外花絮
  if (Math.random() < 0.35) {
    const fluff = [
      {
        headline: `记者观察：${userClub.short} 更衣室传出笑声，气氛${myG >= opG ? "轻松" : "凝重"}`,
        body: `赛后通道有记者听到${myG >= opG ? "胜利歌曲" : "主教练的低声总结"}。知情人士称球队正在为下一场做针对性准备。`,
        tone: myG >= opG ? "positive" : "neutral",
      },
      {
        headline: `球迷之声：${userClub.name} 主场上座率话题冲上热搜`,
        body: `社交媒体上，印有队徽的表情包再次流行。有资深球迷表示：“无论升降级怎么改，我们永远站在看台最后一排。”`,
        tone: "fan",
      },
    ];
    const f = pick(fluff);
    pushMedia(world, {
      outlet: outletByCategory(f.tone === "fan" ? "fan" : "match"),
      headline: f.headline,
      body: f.body,
      tone: f.tone === "fan" ? "positive" : f.tone,
      category: "feature",
    });
  }
}

/** 转会通稿 */
export function mediaTransfer(world, { type, playerName, clubName, otherName, feeText }) {
  if (type === "buy") {
    pushMedia(world, {
      outlet: "转会电报",
      headline: `官宣！${clubName} 签下 ${playerName}，转会费约 ${feeText}`,
      body: `据转会电报消息，${playerName} 已完成体检并与${clubName}签约。${otherName ? `他此前效力于${otherName}。` : ""}分析认为此笔引援将直接补强轮换深度，但也有人担心磨合期。`,
      tone: "positive",
      category: "transfer",
    });
  } else {
    pushMedia(world, {
      outlet: "转会电报",
      headline: `${playerName} 离开${clubName}，加盟${otherName || "新东家"}（${feeText}）`,
      body: `俱乐部官方确认离队。球迷反应两极：有人感谢贡献，也有人质疑“卖人优先级”。更衣室人士称这是“阵容重构的一部分”。`,
      tone: "neutral",
      category: "transfer",
    });
  }
}

/** 青训 / 升级 / 日常 */
export function mediaYouthPromote(world, clubName, playerName, ovr, pot) {
  pushMedia(world, {
    outlet: pick(["VC体育", "战术板"]),
    headline: `青训出品：${playerName} 升入${clubName}一线队（能力${ovr}/潜力${pot}）`,
    body: `学院总监表示：“他训练态度一流，已经做好为成年队出战的准备。”球迷期待再出一个自家青训明星。`,
    tone: "positive",
    category: "youth",
  });
}

export function mediaPromotion(world, clubName, fromName, toName, up) {
  if (up) {
    pushMedia(world, {
      outlet: "联赛日报",
      headline: `升级！${clubName} 从${fromName}杀入${toName}`,
      body: `终场哨响，球员冲进场内狂欢。主席在采访中落泪：“这座城市等这一天太久了。”下赛季对手更强，但梦想已经兑现第一步。`,
      tone: "positive",
      category: "league",
    });
  } else {
    pushMedia(world, {
      outlet: "午夜足球",
      headline: `降级苦果：${clubName} 跌入${toName}`,
      body: `更衣室一片沉默。媒体尖锐追问引援与战术责任。也有专栏作家呼吁：“重建需要时间，球迷的耐心是最贵的转会费。”`,
      tone: "negative",
      category: "league",
    });
  }
}

/** 每日/每周随机媒体（推进日程时） */
export function mediaDailyPulse(world, userClub) {
  if (Math.random() > 0.22) return; // 不是每天都有

  const tableHint = Math.random();
  const name = userClub.name;
  const short = userClub.short;

  if (tableHint < 0.25) {
    pushMedia(world, {
      outlet: outletByCategory("rumor"),
      headline: `传闻：有豪门球探连续两周观看${short}训练`,
      body: `更衣室八卦称，身份不明的球探出现在看台阴影处。俱乐部发言人回应：“正常交流，无可奉告。”真假难辨，但足以让球迷心痒。`,
      tone: "rumor",
      category: "rumor",
    });
  } else if (tableHint < 0.5) {
    pushMedia(world, {
      outlet: "战术板",
      headline: `专栏：${name} 近期节奏偏${pick(["快", "稳", "保守", "激进"])}，下一场或有微调`,
      body: `数据分析显示球队在攻防转换阶段的选择愈发明确。专家建议在定位球环节投入更多训练时间，这往往是中下游球队的“免费进球”。`,
      tone: "neutral",
      category: "tactics",
    });
  } else if (tableHint < 0.75) {
    const stars = userClub.players.slice().sort((a, b) => b.ovr - a.ovr)[0];
    if (stars) {
      pushMedia(world, {
        outlet: "球迷之声",
        headline: `球迷票选：${stars.name} 当选本周${short}人气王`,
        body: `投票由球迷之声发起，超过半数参与者把票投给了${stars.name}。“只要他在场，看台就有鼓点。”——一位赛季票持有者如是说。`,
        tone: "positive",
        category: "fan",
      });
    }
  } else {
    pushMedia(world, {
      outlet: "联赛日报",
      headline: `${pick(["天气", "交通", "球场草坪", "安保"])}话题：${name} 主场比赛日注意事项`,
      body: `联赛日报提醒客队球迷提前入场。俱乐部商业部门也同步推出限定围巾，据称上架一小时即告售罄。`,
      tone: "neutral",
      category: "general",
    });
  }
}

export function mediaSeasonKickoff(world, userClub, divName) {
  pushMedia(world, {
    outlet: "VC体育",
    headline: `${world.season} 赛季特刊：${userClub.name} 出征${divName}`,
    body: `新赛季正式拉开帷幕。VC体育专访写到：“从乙级一路向上是无数经理的梦，而${userClub.short}已经站在了当下属于他们的战场。”本季共 20 队同组厮杀，升级名额愈发珍贵。`,
    tone: "positive",
    category: "league",
  });
}

export function mediaSeasonAwards(world, userClub, pos, divName) {
  let tone = "neutral";
  let headline = `${divName}收官：${userClub.name} 最终第 ${pos} 名`;
  let body = `漫长赛季落下帷幕。媒体为每个名次都写好了剧本——有人超预期，有人掉链子。`;

  if (pos <= 3) {
    tone = "positive";
    headline = `荣耀时刻！${userClub.name} 以第 ${pos} 名结束${divName}征程`;
    body = `香槟与闪光灯属于这座城市。专栏标题写着：“这不是终点，是下一座山的山脚。”`;
  } else if (pos >= 18) {
    tone = "negative";
    headline = `危局：${userClub.name} 第 ${pos} 名收官，媒体要求“重建时间表”`;
    body = `赛季总结会预计不会轻松。有评论员直言转会窗必须有动作，否则下赛季仍将在泥潭挣扎。`;
  }

  pushMedia(world, {
    outlet: "联赛日报",
    headline,
    body,
    tone,
    category: "league",
  });
}

export { OUTLETS };
