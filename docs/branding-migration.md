# VCFM 品牌迁移清单

> 本文档由 `scripts/branding-report.mjs` 从集中式品牌数据生成。旧名称仅用于审查和旧存档迁移，不参与前台展示或业务关联。

## 现状盘点

- 国家与联赛元数据：`js/branding.js`，由 `js/data.js` 适配现有模型后导出。
- 俱乐部、经济参数与完整品牌映射：`js/clubs.js`。
- 球员、俱乐部与联赛赛程生成：`js/models.js`。
- 存档编码与槽位摘要：`js/save.js`；旧世界迁移入口：`migrateWorld()`（`js/main.js`）。
- 杯赛与洲际赛事：`js/cup.js`。
- 队徽没有外部图片；`crest` 是通用程序化参数。球衣由 `ensureKit()` 与 `kitBackground()` 生成。
- 球员用 `player.clubId`，赛程用 `fixture.home` / `fixture.away`，积分榜用 clubId 键；转会、租借、新闻、荣誉和用户执教球队也以 ID 关联。未发现用俱乐部显示名做主键的业务关系。
- 存档保存完整俱乐部对象、球员、赛程、积分榜和赛事对象；加载时按 clubId 刷新当前品牌，不清空或重建这些数据。
- 主要影响页面：开局国家/俱乐部选择、顶栏、积分榜、俱乐部详情、赛程、比赛计分板、转会、新闻、荣誉和存档槽摘要。

## 国家迁移

| internal countryId | countryCode | 旧显示名 | 新中文名 | 新英文名 |
|---|---|---|---|---|
| crownland | ENG | 克朗兰 / Crownland | 英格兰 | England |
| solara | ESP | 索拉拉 / Solara | 西班牙 | Spain |
| belladoro | ITA | 贝拉多罗 / Belladoro | 意大利 | Italy |
| eisenmark | GER | 艾森马克 / Eisenmark | 德国 | Germany |
| lumera | FRA | 卢梅拉 / Lumera | 法国 | France |

## 联赛迁移

| leagueId | countryCode | 旧显示名 | 新中文名 | 新英文名 | 简称 | 俱乐部数 |
|---:|---|---|---|---|---|---:|
| 1 | ENG | 王冠超级联赛 / Crown Premier League | 英格兰超级联赛 | England Premier Division | EPD | 20 |
| 2 | ENG | 王冠甲级联赛 / Crown Championship | 英格兰甲级联赛 | England First Division | EFD | 20 |
| 3 | ENG | 王冠乙级联赛 / Crown League Two | 英格兰乙级联赛 | England Second Division | ESD | 20 |
| 4 | ESP | 索拉拉荣耀联赛 / Solara Glory League | 西班牙甲级联赛 | Spanish First Division | SFD | 16 |
| 5 | ESP | 索拉拉挑战联赛 / Solara Challenge League | 西班牙乙级联赛 | Spanish Second Division | SSD | 16 |
| 6 | GER | 艾森马克铁冠联赛 / Eisenmark Iron Crown | 德国甲级联赛 | German First Division | GFD | 16 |
| 7 | GER | 艾森马克锻造联赛 / Eisenmark Forge League | 德国乙级联赛 | German Second Division | GSD | 16 |
| 8 | ITA | 贝拉多罗金星联赛 / Belladoro Golden Star | 意大利甲级联赛 | Italian First Division | IFD | 16 |
| 9 | ITA | 贝拉多罗银环联赛 / Belladoro Silver Ring | 意大利乙级联赛 | Italian Second Division | ISD | 16 |
| 10 | FRA | 卢梅拉光辉联赛 / Lumera Radiant League | 法国甲级联赛 | French First Division | FFD | 16 |
| 11 | FRA | 卢梅拉晨曦联赛 / Lumera Dawn League | 法国乙级联赛 | French Second Division | FSD | 16 |

## 俱乐部完整映射

| clubId | 旧名称 | 新中文名 | 新英文名 | 简称 | 国家 | leagueId | 主色 | 辅色 | 新球场 | 队徽 | 旧档 |
|---|---|---|---|---|---|---:|---|---|---|---|---|
| vcc | Vanguard City | 金斯福德竞技 | Kingsford Athletic | EKIN | ENG | 1 | #0f766e | #c2410c | 金斯福德公园球场 / Kingsford Park | circle + river | 按 ID 刷新 |
| harbor | Harbourgate Athletic | 红港城 | Redhaven City | ERED | ENG | 1 | #b91c1c | #92400e | 红港球场 / Redhaven Ground | shield + peak | 按 ID 刷新 |
| north | Northbridge United | 北堡流浪者 | Northcastle Rovers | ENOR | ENG | 1 | #1d4ed8 | #334155 | 北堡竞技场 / Northcastle Arena | diamond + wing | 按 ID 刷新 |
| river | Riverside Rovers | 西米尔自治镇 | Westmere Borough | EWES | ENG | 1 | #a16207 | #be123c | 西米尔运动场 / Westmere Field | hexagon + tree | 按 ID 刷新 |
| steel | Steelborough FC | 石桥郡队 | Stonebridge County | ESTO | ENG | 1 | #7e22ce | #15803d | 石桥公园球场 / Stonebridge Park | striped-shield + tower | 按 ID 刷新 |
| capital | Capital Borough | 阿什伯恩谷 | Ashbourne Vale | EASH | ENG | 1 | #047857 | #075985 | 阿什伯恩球场 / Ashbourne Ground | circle + star | 按 ID 刷新 |
| royal | Royal Crest Athletic | 高沼竞技 | Highmoor Athletic | EHIG | ENG | 1 | #be123c | #a16207 | 高沼竞技场 / Highmoor Arena | shield + river | 按 ID 刷新 |
| metro | Metrovale FC | 雷文斯维克城 | Ravenswick City | ERAV | ENG | 1 | #0369a1 | #4338ca | 雷文斯维克运动场 / Ravenswick Field | diamond + peak | 按 ID 刷新 |
| crown | Crownfield United | 橡树郡流浪者 | Oakshire Rovers | EOAK | ENG | 1 | #4d7c0f | #6d28d9 | 橡树郡公园球场 / Oakshire Park | hexagon + wing | 按 ID 刷新 |
| atlas | Atlas Park | 黑水自治镇 | Blackwater Borough | EBLA | ENG | 1 | #c2410c | #0f766e | 黑水球场 / Blackwater Ground | striped-shield + tree | 按 ID 刷新 |
| nova | Novabridge FC | 东米尔漫游者 | Eastmere Wanderers | EEAS | ENG | 1 | #4338ca | #0369a1 | 东米尔竞技场 / Eastmere Arena | circle + tower | 按 ID 刷新 |
| olympic | Olympia Town | 灰堡谷 | Greycastle Vale | EGRE | ENG | 1 | #0e7490 | #9f1239 | 灰堡运动场 / Greycastle Field | shield + star | 按 ID 刷新 |
| titan | Titanford United | 奥尔德维克城 | Alderwick City | EALD | ENG | 1 | #86198f | #3f6212 | 奥尔德维克公园球场 / Alderwick Park | diamond + river | 按 ID 刷新 |
| horizon | Horizon Athletic | 布莱尔福德竞技 | Briarford Athletic | EBRI | ENG | 1 | #15803d | #7e22ce | 布莱尔福德球场 / Briarford Ground | hexagon + peak | 按 ID 刷新 |
| empire | Empire Lane | 莫斯利郡队 | Mossley County | EMOS | ENG | 1 | #9f1239 | #0e7490 | 莫斯利竞技场 / Mossley Arena | striped-shield + wing | 按 ID 刷新 |
| summit | Summit United | 费尔黑文流浪者 | Fairhaven Rovers | EFAI | ENG | 1 | #1e40af | #166534 | 费尔黑文运动场 / Fairhaven Field | circle + tree | 按 ID 刷新 |
| legend | Legendale FC | 温索普自治镇 | Wynthorpe Borough | EWYN | ENG | 1 | #92400e | #b91c1c | 温索普公园球场 / Wynthorpe Park | shield + tower | 按 ID 刷新 |
| prime | Primrose City | 罗斯维克城 | Rosewick City | EROS | ENG | 1 | #6d28d9 | #4d7c0f | 罗斯维克球场 / Rosewick Ground | diamond + star | 按 ID 刷新 |
| galaxy | Galeway United | 科尔德米尔竞技 | Coldmere Athletic | ECOL | ENG | 1 | #166534 | #1e40af | 科尔德米尔竞技场 / Coldmere Arena | hexagon + river | 按 ID 刷新 |
| zenith | Zenith Borough | 埃尔姆斯特德谷 | Elmstead Vale | EELM | ENG | 1 | #c026d3 | #9a3412 | 埃尔姆斯特德运动场 / Elmstead Field | striped-shield + peak | 按 ID 刷新 |
| eagle | Eaglecliff United | 布拉肯福德城 | Brackenford City | EBRA | ENG | 2 | #075985 | #047857 | 布拉肯福德公园球场 / Brackenford Park | circle + wing | 按 ID 刷新 |
| forest | Greenwood Rovers | 松林流浪者 | Pinehurst Rovers | EPIN | ENG | 2 | #3f6212 | #86198f | 松林球场 / Pinehurst Ground | shield + tree | 按 ID 刷新 |
| lion | Lionsgate Athletic | 福克斯米尔竞技 | Foxmere Athletic | EFOX | ENG | 2 | #9a3412 | #c026d3 | 福克斯米尔竞技场 / Foxmere Arena | diamond + tower | 按 ID 刷新 |
| wave | Tideswell FC | 泰德克罗夫特自治镇 | Tidecroft Borough | ETID | ENG | 2 | #334155 | #1d4ed8 | 泰德克罗夫特运动场 / Tidecroft Field | hexagon + star | 按 ID 刷新 |
| canyon | Canyondale Town | 恩伯顿郡队 | Emberton County | EEMB | ENG | 2 | #0f766e | #9f1239 | 恩伯顿公园球场 / Emberton Park | striped-shield + river | 按 ID 刷新 |
| harbor2 | Southharbour FC | 南米尔漫游者 | Southmere Wanderers | ESOU | ENG | 2 | #b91c1c | #3f6212 | 南米尔球场 / Southmere Ground | circle + peak | 按 ID 刷新 |
| phoenix | Phoenixford | 弗林特维克城 | Flintwick City | EFLI | ENG | 2 | #1d4ed8 | #7e22ce | 弗林特维克竞技场 / Flintwick Arena | shield + wing | 按 ID 刷新 |
| aurora | Aurorafield | 荒原谷 | Moorland Vale | EMOO | ENG | 2 | #a16207 | #0e7490 | 荒原运动场 / Moorland Field | diamond + tree | 按 ID 刷新 |
| raven | Raventhorpe | 红溪竞技 | Redbrook Athletic | EREC | ENG | 2 | #7e22ce | #166534 | 红溪公园球场 / Redbrook Park | hexagon + tower | 按 ID 刷新 |
| iron | Ironbridge Athletic | 铜原流浪者 | Copperfield Rovers | ECOP | ENG | 2 | #047857 | #b91c1c | 铜原球场 / Copperfield Ground | striped-shield + star | 按 ID 刷新 |
| storm | Stormhaven FC | 雷恩福德自治镇 | Rainford Borough | ERAI | ENG | 2 | #be123c | #4d7c0f | 雷恩福德竞技场 / Rainford Arena | circle + river | 按 ID 刷新 |
| delta | Deltamouth United | 沼门城 | Marshgate City | EMAR | ENG | 2 | #0369a1 | #1e40af | 沼门运动场 / Marshgate Field | shield + peak | 按 ID 刷新 |
| beacon | Beacon Hill | 灯塔赫斯特郡队 | Beaconhurst County | EBEA | ENG | 2 | #4d7c0f | #9a3412 | 灯塔赫斯特公园球场 / Beaconhurst Park | diamond + wing | 按 ID 刷新 |
| falcon | Falconridge | 猎鹰米尔竞技 | Falconmere Athletic | EFAL | ENG | 2 | #c2410c | #047857 | 猎鹰米尔球场 / Falconmere Ground | hexagon + tree | 按 ID 刷新 |
| ridge | Ridgeway Rovers | 里奇霍尔特流浪者 | Ridgeholt Rovers | ERID | ENG | 2 | #4338ca | #86198f | 里奇霍尔特竞技场 / Ridgeholt Arena | striped-shield + tower | 按 ID 刷新 |
| coral | Coral Bay FC | 珊瑚维克镇 | Coralwick Town | ECOR | ENG | 2 | #0e7490 | #c026d3 | 珊瑚维克镇运动场 / Coralwick Field | circle + star | 按 ID 刷新 |
| pioneer | Pioneer Athletic | 拓荒福德城 | Pioneerford City | EPIO | ENG | 2 | #86198f | #1d4ed8 | 拓荒福德公园球场 / Pioneerford Park | shield + river | 按 ID 刷新 |
| comet | Cometbury Town | 椋鸟谷 | Starling Vale | ESTA | ENG | 2 | #15803d | #c2410c | 椋鸟球场 / Starling Ground | diamond + peak | 按 ID 刷新 |
| bastion | Bastion United | 花岗比竞技 | Graniteby Athletic | EGRA | ENG | 2 | #9f1239 | #92400e | 花岗比竞技场 / Graniteby Arena | hexagon + wing | 按 ID 刷新 |
| mirage | Mirage Town | 飞燕草自治镇 | Larkspur Borough | ELAR | ENG | 2 | #1e40af | #334155 | 飞燕草运动场 / Larkspur Field | striped-shield + tree | 按 ID 刷新 |
| sunset | Westend Town | 桑米尔漫游者 | Sunmere Wanderers | ESUN | ENG | 3 | #92400e | #be123c | 桑米尔公园球场 / Sunmere Park | circle + tower | 按 ID 刷新 |
| mill | Millford United | 米尔黑文竞技 | Millhaven Athletic | EMIL | ENG | 3 | #6d28d9 | #15803d | 米尔黑文球场 / Millhaven Ground | shield + star | 按 ID 刷新 |
| dock | Dockside Athletic | 多克米尔城 | Dockmere City | EDOC | ENG | 3 | #166534 | #075985 | 多克米尔竞技场 / Dockmere Arena | diamond + river | 按 ID 刷新 |
| valley | Valleyford FC | 谷地流浪者 | Valleydown Rovers | EVAL | ENG | 3 | #c026d3 | #a16207 | 谷地运动场 / Valleydown Field | hexagon + peak | 按 ID 刷新 |
| bridge | Longbridge Rovers | 朗芬自治镇 | Longfen Borough | ELON | ENG | 3 | #075985 | #4338ca | 朗芬公园球场 / Longfen Park | striped-shield + wing | 按 ID 刷新 |
| mines | Miners United | 奎里米尔郡队 | Quarrymere County | EQUA | ENG | 3 | #3f6212 | #6d28d9 | 奎里米尔球场 / Quarrymere Ground | circle + tree | 按 ID 刷新 |
| farm | Farmstead FC | 法姆利竞技 | Farmleigh Athletic | EFAR | ENG | 3 | #9a3412 | #0f766e | 法姆利竞技场 / Farmleigh Arena | shield + tower | 按 ID 刷新 |
| village | Village Green | 绿谷 | Greenhollow Vale | EGRV | ENG | 3 | #334155 | #0369a1 | 绿运动场 / Greenhollow Field | diamond + star | 按 ID 刷新 |
| harbor3 | Westbay United | 西湾漫游者 | Westbay Wanderers | EWEW | ENG | 3 | #0f766e | #c026d3 | 西湾公园球场 / Westbay Park | hexagon + river | 按 ID 刷新 |
| chapel | Chapelgate | 查珀尔维克城 | Chapelwick City | ECHA | ENG | 3 | #b91c1c | #1d4ed8 | 查珀尔维克球场 / Chapelwick Ground | striped-shield + peak | 按 ID 刷新 |
| quarry | Quarrytown FC | 斯莱特伯里流浪者 | Slatebury Rovers | ESLA | ENG | 3 | #1d4ed8 | #c2410c | 斯莱特伯里竞技场 / Slatebury Arena | circle + wing | 按 ID 刷新 |
| meadow | Meadowbank | 草甸克罗夫特自治镇 | Meadowcroft Borough | EMEA | ENG | 3 | #a16207 | #92400e | 草甸克罗夫特运动场 / Meadowcroft Field | shield + tree | 按 ID 刷新 |
| lantern | Lantern Borough | 兰特恩米尔竞技 | Lanternmere Athletic | ELAN | ENG | 3 | #7e22ce | #334155 | 兰特恩米尔公园球场 / Lanternmere Park | diamond + tower | 按 ID 刷新 |
| ferry | Ferrybridge Athletic | 费里霍尔特郡队 | Ferryholt County | EFER | ENG | 3 | #047857 | #be123c | 费里霍尔特球场 / Ferryholt Ground | hexagon + star | 按 ID 刷新 |
| orchard | Orchard United | 果园维克谷 | Orchardwick Vale | EORC | ENG | 3 | #be123c | #15803d | 果园维克竞技场 / Orchardwick Arena | striped-shield + river | 按 ID 刷新 |
| slate | Slateford Town | 柳沼流浪者 | Willowfen Rovers | EWIL | ENG | 3 | #0369a1 | #075985 | 柳沼运动场 / Willowfen Field | circle + peak | 按 ID 刷新 |
| willow | Willowdale FC | 布鲁克米尔城 | Brookmere City | EBRO | ENG | 3 | #4d7c0f | #a16207 | 布鲁克米尔公园球场 / Brookmere Park | shield + wing | 按 ID 刷新 |
| brook | Brookside Athletic | 安克利竞技 | Anchorleigh Athletic | EANC | ENG | 3 | #c2410c | #4338ca | 安克利球场 / Anchorleigh Ground | diamond + tree | 按 ID 刷新 |
| anchor | Anchorage FC | 炉原自治镇 | Hearthmoor Borough | EHEA | ENG | 3 | #4338ca | #6d28d9 | 炉原竞技场 / Hearthmoor Arena | hexagon + tower | 按 ID 刷新 |
| hearth | Hearthfield Town | 邓里奇漫游者 | Dunridge Wanderers | EDUN | ENG | 3 | #0e7490 | #0f766e | 邓里奇运动场 / Dunridge Field | striped-shield + star | 按 ID 刷新 |
| sol_4_01 | Aurelia CF | 索尔马竞技 | Atlético Solmar | ESOL | ESP | 4 | #86198f | #0369a1 | 索尔马公园球场 / Solmar Park | circle + river | 按 ID 刷新 |
| sol_4_02 | Puerto Celeste | 瓦尔多罗体育 | Deportivo Valdoro | EVAJ | ESP | 4 | #15803d | #9f1239 | 瓦尔多罗球场 / Valdoro Ground | shield + peak | 按 ID 刷新 |
| sol_4_03 | Monteluz Union | 蒙特克拉罗联盟 | Unión Monteclaro | EMON | ESP | 4 | #9f1239 | #3f6212 | 蒙特克拉罗竞技场 / Monteclaro Arena | diamond + wing | 按 ID 刷新 |
| sol_4_04 | Valdora Atletico | 雷阿尔塔港竞技 | Sporting Puerto Realta | EPUE | ESP | 4 | #1e40af | #7e22ce | 雷阿尔塔港运动场 / Puerto Realta Field | hexagon + tree | 按 ID 刷新 |
| sol_4_05 | Costa Alba FC | 蓝山俱乐部 | Club Sierra Azul | ESIE | ESP | 4 | #92400e | #0e7490 | 蓝山公园球场 / Sierra Azul Park | striped-shield + tower | 按 ID 刷新 |
| sol_4_06 | Sierra Dorada | 红海岸足球会 | Costa Roja CF | ECOS | ESP | 4 | #6d28d9 | #166534 | 红海岸球场 / Costa Roja Ground | circle + star | 按 ID 刷新 |
| sol_4_07 | Maravilla SC | 维拉露娜竞技 | Villaluna Atlético | EVIL | ESP | 4 | #166534 | #b91c1c | 维拉露娜竞技场 / Villaluna Arena | shield + river | 按 ID 刷新 |
| sol_4_08 | Rio Claro Athletic | 白河体育 | Río Blanco Deportivo | ERIO | ESP | 4 | #c026d3 | #4d7c0f | 白河运动场 / Río Blanco Field | diamond + peak | 按 ID 刷新 |
| sol_4_09 | Estrella Roja | 绿野足球会 | Campo Verde CF | ECAM | ESP | 4 | #075985 | #1e40af | 绿野公园球场 / Campo Verde Park | hexagon + wing | 按 ID 刷新 |
| sol_4_10 | Campo Verde | 阿尔塔米拉联盟 | Altamira Unión | EALT | ESP | 4 | #3f6212 | #9a3412 | 阿尔塔米拉球场 / Altamira Ground | striped-shield + tree | 按 ID 刷新 |
| sol_4_11 | Torreluna FC | 蓝海竞技 | Marazul Sporting | EMAS | ESP | 4 | #9a3412 | #047857 | 蓝海竞技场 / Marazul Arena | circle + tower | 按 ID 刷新 |
| sol_4_12 | Bahia Serena | 金丘足球会 | Cerro Dorado CF | ECER | ESP | 4 | #334155 | #86198f | 金丘运动场 / Cerro Dorado Field | shield + star | 按 ID 刷新 |
| sol_4_13 | Alcazar Nova | 塞雷纳谷体育 | Valle Serena Deportivo | EVAU | ESP | 4 | #0f766e | #0e7490 | 塞雷纳谷公园球场 / Valle Serena Park | diamond + river | 按 ID 刷新 |
| sol_4_14 | Villasol United | 卢兹马尔竞技 | Luzmar Atlético | ELUZ | ESP | 4 | #b91c1c | #0369a1 | 卢兹马尔球场 / Luzmar Ground | hexagon + peak | 按 ID 刷新 |
| sol_4_15 | Cobre Vista | 克拉拉河岸足球会 | Ribera Clara CF | ERIB | ESP | 4 | #1d4ed8 | #9f1239 | 克拉拉河岸竞技场 / Ribera Clara Arena | striped-shield + wing | 按 ID 刷新 |
| sol_4_16 | Mirador CF | 索尔坎托联盟 | Solcanto Unión | ESOX | ESP | 4 | #a16207 | #3f6212 | 索尔坎托运动场 / Solcanto Field | circle + tree | 按 ID 刷新 |
| sol_5_01 | Loma Azul | 蒙特露娜体育 | Monteluna Deportivo | EMOY | ESP | 5 | #7e22ce | #1e40af | 蒙特露娜公园球场 / Monteluna Park | shield + tower | 按 ID 刷新 |
| sol_5_02 | Puerto Sol | 微风港足球会 | Puerto Brisa CF | EPUZ | ESP | 5 | #047857 | #0e7490 | 微风港球场 / Puerto Brisa Ground | diamond + star | 按 ID 刷新 |
| sol_5_03 | Valmera Deportivo | 阿尔巴山联盟 | Sierra Alba Unión | ESIA | ESP | 5 | #be123c | #166534 | 阿尔巴山竞技场 / Sierra Alba Arena | hexagon + river | 按 ID 刷新 |
| sol_5_04 | Prado Alto | 绿海岸竞技 | Costa Verde Sporting | ECOB | ESP | 5 | #0369a1 | #b91c1c | 绿海岸运动场 / Costa Verde Field | striped-shield + peak | 按 ID 刷新 |
| sol_5_05 | Roca Blanca | 新村太阳足球会 | Villanueva Sol CF | EVIC | ESP | 5 | #4d7c0f | #c026d3 | 新村太阳公园球场 / Villanueva Sol Park | circle + wing | 按 ID 刷新 |
| sol_5_06 | Nueva Espera | 绯红河体育 | Río Carmesí Deportivo | ERIE | ESP | 5 | #c2410c | #1e40af | 绯红河球场 / Río Carmesí Ground | shield + tree | 按 ID 刷新 |
| sol_5_07 | Arco del Mar | 北野联盟 | Campo Norte Unión | ECAE | ESP | 5 | #4338ca | #9a3412 | 北野竞技场 / Campo Norte Arena | diamond + tower | 按 ID 刷新 |
| sol_5_08 | Santa Vega | 克拉拉山坡足球会 | Loma Clara CF | ELOM | ESP | 5 | #0e7490 | #047857 | 克拉拉山坡运动场 / Loma Clara Field | hexagon + star | 按 ID 刷新 |
| sol_5_09 | Fuente Oro | 蓝湾竞技 | Marina Azul Atlético | EMAG | ESP | 5 | #86198f | #334155 | 蓝湾公园球场 / Marina Azul Park | striped-shield + river | 按 ID 刷新 |
| sol_5_10 | Brisa Norte | 南瓦尔多罗体育 | Valdoro Sur Deportivo | EVAH | ESP | 5 | #15803d | #c026d3 | 南瓦尔多罗球场 / Valdoro Sur Ground | circle + peak | 按 ID 刷新 |
| sol_5_11 | Olivar FC | 索列拉足球会 | Solierra CF | ESOI | ESP | 5 | #9f1239 | #1d4ed8 | 索列拉竞技场 / Solierra Arena | shield + wing | 按 ID 刷新 |
| sol_5_12 | Canto Claro | 塞雷纳石镇联盟 | Piedra Serena Unión | EPIE | ESP | 5 | #1e40af | #c2410c | 塞雷纳石镇运动场 / Piedra Serena Field | diamond + tree | 按 ID 刷新 |
| sol_5_13 | Arena Sur | 月湾竞技 | Bahía Luna Sporting | EBAH | ESP | 5 | #92400e | #a16207 | 月湾公园球场 / Bahía Luna Park | hexagon + tower | 按 ID 刷新 |
| sol_5_14 | Lago Rojo | 红山足球会 | Monte Rojo CF | EMOL | ESP | 5 | #6d28d9 | #334155 | 红山球场 / Monte Rojo Ground | striped-shield + star | 按 ID 刷新 |
| sol_5_15 | Camino Unido | 阳光草原体育 | Pradera Sol Deportivo | EPRA | ESP | 5 | #166534 | #be123c | 阳光草原竞技场 / Pradera Sol Arena | circle + river | 按 ID 刷新 |
| sol_5_16 | Sol del Este | 海歌联盟 | Canto del Mar Unión | ECAN | ESP | 5 | #c026d3 | #15803d | 海歌运动场 / Canto del Mar Field | shield + peak | 按 ID 刷新 |
| eis_6_01 | Falkenstadt SV | 艾森布吕克足球会 | FC Eisenbruck | GEIS | GER | 6 | #075985 | #0369a1 | 艾森布吕克公园球场 / Eisenbruck Park | diamond + wing | 按 ID 刷新 |
| eis_6_02 | Eisenhafen 04 | 瓦尔德海姆体育会 | SV Waldheim | GWAL | GER | 6 | #3f6212 | #a16207 | 瓦尔德海姆球场 / Waldheim Ground | hexagon + tree | 按 ID 刷新 |
| eis_6_03 | Kronberg FC | 诺德哈芬竞技协会 | VfR Nordhafen | GNOR | GER | 6 | #9a3412 | #4338ca | 诺德哈芬竞技场 / Nordhafen Arena | striped-shield + tower | 按 ID 刷新 |
| eis_6_04 | Adlerbruck | 法尔肯施塔特团结队 | Eintracht Falkenstadt | GFAL | GER | 6 | #334155 | #6d28d9 | 法尔肯施塔特运动场 / Falkenstadt Field | circle + star | 按 ID 刷新 |
| eis_6_05 | Stahlheim Union | 锡尔伯格福图纳 | Fortuna Silberberg | GSIL | GER | 6 | #0f766e | #047857 | 锡尔伯格公园球场 / Silberberg Park | shield + river | 按 ID 刷新 |
| eis_6_06 | Nordfels 09 | 格林瓦尔德足球会 | FC Grünwald | GGRU | GER | 6 | #b91c1c | #86198f | 格林瓦尔德球场 / Grünwald Ground | diamond + peak | 按 ID 刷新 |
| eis_6_07 | Waldkirch SC | 莱茵布吕克体育会 | SV Rheinbruck | GRHE | GER | 6 | #1d4ed8 | #c026d3 | 莱茵布吕克竞技场 / Rheinbruck Arena | hexagon + wing | 按 ID 刷新 |
| eis_6_08 | Blauwerk FC | 克罗嫩塔尔竞技协会 | VfR Kronental | GKRO | GER | 6 | #a16207 | #1d4ed8 | 克罗嫩塔尔运动场 / Kronental Field | striped-shield + tree | 按 ID 刷新 |
| eis_6_09 | Rotental 08 | 阿德勒费尔德团结队 | Eintracht Adlerfeld | GADL | GER | 6 | #7e22ce | #c2410c | 阿德勒费尔德公园球场 / Adlerfeld Park | circle + tower | 按 ID 刷新 |
| eis_6_10 | Bergwacht | 韦斯特塔尔福图纳 | Fortuna Westtal | GWES | GER | 6 | #047857 | #92400e | 韦斯特塔尔球场 / Westtal Ground | shield + star | 按 ID 刷新 |
| eis_6_11 | Lindenbruck | 摩根海恩足球会 | FC Morgenhain | GMOR | GER | 6 | #be123c | #334155 | 摩根海恩竞技场 / Morgenhain Arena | diamond + river | 按 ID 刷新 |
| eis_6_12 | Hafenkrone | 霍恩马克体育会 | SV Hohenmark | GHOH | GER | 6 | #0369a1 | #be123c | 霍恩马克运动场 / Hohenmark Field | hexagon + peak | 按 ID 刷新 |
| eis_6_13 | Silbersee | 利希特瓦尔德竞技协会 | VfR Lichtwald | GLIC | GER | 6 | #4d7c0f | #15803d | 利希特瓦尔德公园球场 / Lichtwald Park | striped-shield + wing | 按 ID 刷新 |
| eis_6_14 | Donnerfeld | 布吕肯瑙团结队 | Eintracht Brückenau | GBRU | GER | 6 | #c2410c | #075985 | 布吕肯瑙球场 / Brückenau Ground | circle + tree | 按 ID 刷新 |
| eis_6_15 | Morgenstadt | 坦嫩格伦德福图纳 | Fortuna Tannengrund | GTAN | GER | 6 | #4338ca | #a16207 | 坦嫩格伦德竞技场 / Tannengrund Arena | shield + tower | 按 ID 刷新 |
| eis_6_16 | Westtor SV | 库普费尔海恩足球会 | FC Kupferhain | GKUP | GER | 6 | #0e7490 | #4338ca | 库普费尔海恩运动场 / Kupferhain Field | diamond + star | 按 ID 刷新 |
| eis_7_01 | Kupferwald | 法尔肯里德体育会 | SV Falkenried | GFAE | GER | 7 | #86198f | #6d28d9 | 法尔肯里德公园球场 / Falkenried Park | hexagon + river | 按 ID 刷新 |
| eis_7_02 | Steinbach 07 | 施泰因布伦足球会 | FC Steinbrunn | GSTE | GER | 7 | #15803d | #0f766e | 施泰因布伦球场 / Steinbrunn Ground | striped-shield + peak | 按 ID 刷新 |
| eis_7_03 | Grunhafen | 格林哈芬竞技协会 | VfR Grünhafen | GGRG | GER | 7 | #9f1239 | #0369a1 | 格林哈芬竞技场 / Grünhafen Arena | circle + wing | 按 ID 刷新 |
| eis_7_04 | Ostmarke FC | 奥斯塔尔团结队 | Eintracht Osttal | GOST | GER | 7 | #1e40af | #9f1239 | 奥斯塔尔运动场 / Osttal Field | shield + tree | 按 ID 刷新 |
| eis_7_05 | Tannenfels | 内贝尔格伦德福图纳 | Fortuna Nebelgrund | GNEB | GER | 7 | #92400e | #3f6212 | 内贝尔格伦德公园球场 / Nebelgrund Park | diamond + tower | 按 ID 刷新 |
| eis_7_06 | Hochbruck | 霍赫瓦尔德足球会 | FC Hochwald | GHOC | GER | 7 | #6d28d9 | #7e22ce | 霍赫瓦尔德球场 / Hochwald Ground | hexagon + star | 按 ID 刷新 |
| eis_7_07 | Eisental | 艾森塔尔体育会 | SV Eisental | GEIK | GER | 7 | #166534 | #0e7490 | 艾森塔尔竞技场 / Eisental Arena | striped-shield + river | 按 ID 刷新 |
| eis_7_08 | Sudtor 05 | 南布吕克竞技协会 | VfR Südbrück | GSUD | GER | 7 | #c026d3 | #166534 | 南布吕克运动场 / Südbrück Field | circle + peak | 按 ID 刷新 |
| eis_7_09 | Nebelstadt | 锡尔伯海恩团结队 | Eintracht Silberhain | GSIM | GER | 7 | #075985 | #b91c1c | 锡尔伯海恩公园球场 / Silberhain Park | shield + wing | 按 ID 刷新 |
| eis_7_10 | Hammersee | 哈默费尔德福图纳 | Fortuna Hammerfeld | GHAM | GER | 7 | #3f6212 | #4d7c0f | 哈默费尔德球场 / Hammerfeld Ground | diamond + tree | 按 ID 刷新 |
| eis_7_11 | Weissburg | 魏森塔尔足球会 | FC Weissental | GWEI | GER | 7 | #9a3412 | #1e40af | 魏森塔尔竞技场 / Weissental Arena | hexagon + tower | 按 ID 刷新 |
| eis_7_12 | Rotbruck | 罗特海德体育会 | SV Rotheide | GROT | GER | 7 | #334155 | #9a3412 | 罗特海德运动场 / Rotheide Field | striped-shield + star | 按 ID 刷新 |
| eis_7_13 | Feldkrone | 费尔德克兰茨竞技协会 | VfR Feldkranz | GFEL | GER | 7 | #0f766e | #4338ca | 费尔德克兰茨公园球场 / Feldkranz Park | circle + river | 按 ID 刷新 |
| eis_7_14 | Adlerhain | 阿德勒海恩团结队 | Eintracht Adlerhain | GADR | GER | 7 | #b91c1c | #6d28d9 | 阿德勒海恩球场 / Adlerhain Ground | shield + peak | 按 ID 刷新 |
| eis_7_15 | Werkstadt | 韦尔克塔尔福图纳 | Fortuna Werkental | GWER | GER | 7 | #1d4ed8 | #0f766e | 韦尔克塔尔竞技场 / Werkental Arena | diamond + wing | 按 ID 刷新 |
| eis_7_16 | Mondtal SC | 蒙德塔尔足球会 | FC Mondtal | GMON | GER | 7 | #a16207 | #0369a1 | 蒙德塔尔运动场 / Mondtal Field | hexagon + tree | 按 ID 刷新 |
| bel_8_01 | Aurora Calcio | 瓦尔多里亚竞技 | AC Valdoria | IVAL | ITA | 8 | #7e22ce | #9f1239 | 瓦尔多里亚公园球场 / Valdoria Park | striped-shield + tower | 按 ID 刷新 |
| bel_8_02 | Porto d'Oro | 蒙特韦尔德足球会 | FC Monteverde | IMON | ITA | 8 | #047857 | #3f6212 | 蒙特韦尔德球场 / Monteverde Ground | circle + star | 按 ID 刷新 |
| bel_8_03 | Valdoro FC | 贝拉科斯塔足球会 | Calcio Bellacosta | IBEL | ITA | 8 | #be123c | #7e22ce | 贝拉科斯塔竞技场 / Bellacosta Arena | shield + river | 按 ID 刷新 |
| bel_8_04 | Citta Nova | 奥雷利奥港联盟 | Unione Porto Aurelio | IPOR | ITA | 8 | #0369a1 | #0e7490 | 奥雷利奥港运动场 / Porto Aurelio Field | diamond + peak | 按 ID 刷新 |
| bel_8_05 | Rosalba 1912 | 圣切莱斯特维尔图斯 | Virtus San Celeste | ISAN | ITA | 8 | #4d7c0f | #166534 | 圣切莱斯特公园球场 / San Celeste Park | hexagon + wing | 按 ID 刷新 |
| bel_8_06 | Montechiaro | 罗卡内拉体育 | Rocca Nera Sportiva | IROC | ITA | 8 | #c2410c | #b91c1c | 罗卡内拉球场 / Rocca Nera Ground | striped-shield + tree | 按 ID 刷新 |
| bel_8_07 | Rivabella | 卡斯特尔文托足球会 | Castelvento Calcio | ICAS | ITA | 8 | #4338ca | #4d7c0f | 卡斯特尔文托竞技场 / Castelvento Arena | circle + tower | 按 ID 刷新 |
| bel_8_08 | Aquila Nera | 里瓦贝拉足球会 | Rivabella FC | IRIV | ITA | 8 | #0e7490 | #1e40af | 里瓦贝拉运动场 / Rivabella Field | shield + star | 按 ID 刷新 |
| bel_8_09 | Stella Marina | 阿尔塔维拉联盟 | Altavilla Unione | IALT | ITA | 8 | #86198f | #9a3412 | 阿尔塔维拉公园球场 / Altavilla Park | diamond + river | 按 ID 刷新 |
| bel_8_10 | Fortuna Verde | 丰特卢切体育 | Fonteluce Sportiva | IFON | ITA | 8 | #15803d | #047857 | 丰特卢切球场 / Fonteluce Ground | hexagon + peak | 按 ID 刷新 |
| bel_8_11 | Torriano | 塞雷纳尔托竞技 | AC Serenalto | ISER | ITA | 8 | #9f1239 | #86198f | 塞雷纳尔托竞技场 / Serenalto Arena | striped-shield + wing | 按 ID 刷新 |
| bel_8_12 | Lago Azzurro | 皮耶特拉多罗足球会 | FC Pietradoro | IPIE | ITA | 8 | #1e40af | #c026d3 | 皮耶特拉多罗运动场 / Pietradoro Field | circle + tree | 按 ID 刷新 |
| bel_8_13 | Borgo Sole | 文托阿尔托足球会 | Calcio Ventoalto | IVEN | ITA | 8 | #92400e | #1d4ed8 | 文托阿尔托公园球场 / Ventoalto Park | shield + tower | 按 ID 刷新 |
| bel_8_14 | Granvista | 马里索莱联盟 | Unione Marisole | IMAR | ITA | 8 | #6d28d9 | #c2410c | 马里索莱球场 / Marisole Ground | diamond + star | 按 ID 刷新 |
| bel_8_15 | Virtu Bellena | 科莱基亚罗维尔图斯 | Virtus Collechiaro | ICOL | ITA | 8 | #166534 | #92400e | 科莱基亚罗竞技场 / Collechiaro Arena | hexagon + river | 按 ID 刷新 |
| bel_8_16 | Pietraluna | 罗卡韦尔德足球会 | Rocca Verde FC | IROJ | ITA | 8 | #c026d3 | #334155 | 罗卡韦尔德运动场 / Rocca Verde Field | striped-shield + peak | 按 ID 刷新 |
| bel_9_01 | Colleverde | 蒙特卢梅竞技 | AC Montelume | IMOK | ITA | 9 | #075985 | #be123c | 蒙特卢梅公园球场 / Montelume Park | circle + wing | 按 ID 刷新 |
| bel_9_02 | Marina Rossa | 贝拉里瓦足球会 | FC Bellariva | IBEM | ITA | 9 | #3f6212 | #15803d | 贝拉里瓦球场 / Bellariva Ground | shield + tree | 按 ID 刷新 |
| bel_9_03 | Casalvento | 波尔托文托足球会 | Calcio Portovento | IPOM | ITA | 9 | #9a3412 | #075985 | 波尔托文托竞技场 / Portovento Arena | diamond + tower | 按 ID 刷新 |
| bel_9_04 | Fontebella | 瓦尔塞雷纳联盟 | Unione Valserena | IVAN | ITA | 9 | #334155 | #a16207 | 瓦尔塞雷纳运动场 / Valserena Field | hexagon + star | 按 ID 刷新 |
| bel_9_05 | Alba Nuova | 卡斯特尔索莱维尔图斯 | Virtus Castelsole | ICAO | ITA | 9 | #0f766e | #1e40af | 卡斯特尔索莱公园球场 / Castelsole Park | striped-shield + river | 按 ID 刷新 |
| bel_9_06 | Portoforte | 里瓦福尔泰体育 | Rivaforte Sportiva | IRIP | ITA | 9 | #b91c1c | #9a3412 | 里瓦福尔泰球场 / Rivaforte Ground | circle + peak | 按 ID 刷新 |
| bel_9_07 | Vigna d'Oro | 卢纳科斯塔竞技 | AC Lunacosta | ILUN | ITA | 9 | #1d4ed8 | #047857 | 卢纳科斯塔竞技场 / Lunacosta Arena | shield + wing | 按 ID 刷新 |
| bel_9_08 | Serradoro | 丰塔内拉足球会 | FC Fontanera | IFOR | ITA | 9 | #a16207 | #86198f | 丰塔内拉运动场 / Fontanera Field | diamond + tree | 按 ID 刷新 |
| bel_9_09 | Pontechiaro | 博尔戈卢切足球会 | Calcio Borgoluce | IBOR | ITA | 9 | #7e22ce | #c026d3 | 博尔戈卢切公园球场 / Borgoluce Park | hexagon + tower | 按 ID 刷新 |
| bel_9_10 | Rocca Nova | 罗卡费尔马联盟 | Unione Roccaferma | IROT | ITA | 9 | #047857 | #1d4ed8 | 罗卡费尔马球场 / Roccaferma Ground | striped-shield + star | 按 ID 刷新 |
| bel_9_11 | Campo Fiore | 马雷基亚罗维尔图斯 | Virtus Marechiaro | IMAU | ITA | 9 | #be123c | #c2410c | 马雷基亚罗竞技场 / Marechiaro Arena | circle + river | 按 ID 刷新 |
| bel_9_12 | Valle Serena | 瓦莱翁布拉竞技 | AC Valleombra | IVAV | ITA | 9 | #0369a1 | #92400e | 瓦莱翁布拉运动场 / Valleombra Field | shield + peak | 按 ID 刷新 |
| bel_9_13 | Marevento | 阿尔塔切洛足球会 | FC Altacielo | IALW | ITA | 9 | #4d7c0f | #334155 | 阿尔塔切洛公园球场 / Altacielo Park | diamond + wing | 按 ID 刷新 |
| bel_9_14 | Luna Calcio | 圣维雷洛足球会 | Calcio San Virello | ISAX | ITA | 9 | #c2410c | #be123c | 圣维雷洛球场 / San Virello Ground | hexagon + tree | 按 ID 刷新 |
| bel_9_15 | Ferrovia AC | 卡斯特尔罗萨联盟 | Unione Castelrosa | ICAY | ITA | 9 | #4338ca | #15803d | 卡斯特尔罗萨竞技场 / Castelrosa Arena | striped-shield + tower | 按 ID 刷新 |
| bel_9_16 | Orizzonte | 坎波拉戈维尔图斯 | Virtus Campolago | ICAM | ITA | 9 | #0e7490 | #075985 | 坎波拉戈运动场 / Campolago Field | circle + star | 按 ID 刷新 |
| lum_10_01 | Lumeris FC | 贝勒蒙足球会 | FC Bellemont | FBEL | FRA | 10 | #86198f | #a16207 | 贝勒蒙公园球场 / Bellemont Park | shield + river | 按 ID 刷新 |
| lum_10_02 | Belle-Rive AC | 瓦勒鲁日体育会 | AS Valrouge | FVAL | FRA | 10 | #15803d | #4338ca | 瓦勒鲁日球场 / Valrouge Ground | diamond + peak | 按 ID 刷新 |
| lum_10_03 | Valcroix Union | 蒙克莱尔奥林匹克 | Olympique Montclair | FMON | FRA | 10 | #9f1239 | #6d28d9 | 蒙克莱尔竞技场 / Montclair Arena | hexagon + wing | 按 ID 刷新 |
| lum_10_04 | Aurore Sport | 圣奥雷尔竞速会 | Racing Saint-Aurel | FSAI | FRA | 10 | #1e40af | #0f766e | 圣奥雷尔运动场 / Saint-Aurel Field | striped-shield + tree | 按 ID 刷新 |
| lum_10_05 | Rochebleue | 银岸联盟 | Union Cote d'Argent | FCOT | FRA | 10 | #92400e | #0369a1 | 银岸公园球场 / Cote d'Argent Park | circle + tower | 按 ID 刷新 |
| lum_10_06 | Port-Lumiere | 蓝河体育会 | Stade Riviere Bleue | FRIV | FRA | 10 | #6d28d9 | #9f1239 | 蓝河球场 / Riviere Bleue Ground | shield + star | 按 ID 刷新 |
| lum_10_07 | Ciel Rouge FC | 光港足球会 | FC Port-Lumiere | FPOR | FRA | 10 | #166534 | #3f6212 | 光港竞技场 / Port-Lumiere Arena | diamond + river | 按 ID 刷新 |
| lum_10_08 | Grandval Athletic | 大谷体育会 | AS Grandvallon | FGRA | FRA | 10 | #c026d3 | #7e22ce | 大谷运动场 / Grandvallon Field | hexagon + peak | 按 ID 刷新 |
| lum_10_09 | Bois d'Argent | 欧特福尔奥林匹克 | Olympique Hautefort | FHAU | FRA | 10 | #075985 | #0e7490 | 欧特福尔公园球场 / Hautefort Park | striped-shield + wing | 按 ID 刷新 |
| lum_10_10 | Vallonne SC | 克莱尔布瓦竞速会 | Racing Clairbois | FCLA | FRA | 10 | #3f6212 | #166534 | 克莱尔布瓦球场 / Clairbois Ground | circle + tree | 按 ID 刷新 |
| lum_10_11 | Marais Royal | 瓦尔迪讷联盟 | Union Valdune | FVAK | FRA | 10 | #9a3412 | #b91c1c | 瓦尔迪讷竞技场 / Valdune Arena | shield + tower | 按 ID 刷新 |
| lum_10_12 | Etoile d'Azur | 贝尔里夫体育会 | Stade Belle-Rive | FBEM | FRA | 10 | #334155 | #4d7c0f | 贝尔里夫运动场 / Belle-Rive Field | diamond + star | 按 ID 刷新 |
| lum_10_13 | Couronne FC | 蒙多里耶足球会 | FC Montdoriel | FMOM | FRA | 10 | #0f766e | #075985 | 蒙多里耶公园球场 / Montdoriel Park | hexagon + river | 按 ID 刷新 |
| lum_10_14 | Riveneuve | 里夫蒙体育会 | AS Rivemont | FRIN | FRA | 10 | #b91c1c | #a16207 | 里夫蒙球场 / Rivemont Ground | striped-shield + peak | 按 ID 刷新 |
| lum_10_15 | Montfleur | 布瓦克莱尔奥林匹克 | Olympique Boisclair | FBOI | FRA | 10 | #1d4ed8 | #4338ca | 布瓦克莱尔竞技场 / Boisclair Arena | circle + wing | 按 ID 刷新 |
| lum_10_16 | Nordlac | 奥里维尔竞速会 | Racing Auriville | FAUR | FRA | 10 | #a16207 | #6d28d9 | 奥里维尔运动场 / Auriville Field | shield + tree | 按 ID 刷新 |
| lum_11_01 | Petit-Pont | 瓦尔桑德足球会 | FC Valcendre | FVAQ | FRA | 11 | #7e22ce | #0f766e | 瓦尔桑德公园球场 / Valcendre Park | diamond + tower | 按 ID 刷新 |
| lum_11_02 | Clairbois | 蒙福沃体育会 | AS Montfauve | FMOR | FRA | 11 | #047857 | #0369a1 | 蒙福沃球场 / Montfauve Ground | hexagon + star | 按 ID 刷新 |
| lum_11_03 | Rougeval | 波特吕讷联盟 | Union Portelune | FPOS | FRA | 11 | #be123c | #9f1239 | 波特吕讷竞技场 / Portelune Arena | striped-shield + river | 按 ID 刷新 |
| lum_11_04 | Sudriviere | 欧特里夫体育会 | Stade Hauterive | FHAT | FRA | 11 | #0369a1 | #3f6212 | 欧特里夫运动场 / Hauterive Field | circle + peak | 按 ID 刷新 |
| lum_11_05 | Chateau-Lune | 克莱瓦尔足球会 | FC Clairval | FCLU | FRA | 11 | #4d7c0f | #7e22ce | 克莱瓦尔公园球场 / Clairval Park | shield + wing | 按 ID 刷新 |
| lum_11_06 | Fontelune | 格朗布瓦竞速会 | Racing Grandbois | FGRV | FRA | 11 | #c2410c | #0e7490 | 格朗布瓦球场 / Grandbois Ground | diamond + tree | 按 ID 刷新 |
| lum_11_07 | Aigle Blanc | 新河岸体育会 | AS Neufrivage | FNEU | FRA | 11 | #4338ca | #166534 | 新河岸竞技场 / Neufrivage Arena | hexagon + tower | 按 ID 刷新 |
| lum_11_08 | Verteville | 罗什帕勒奥林匹克 | Olympique Rochepale | FROC | FRA | 11 | #0e7490 | #b91c1c | 罗什帕勒运动场 / Rochepale Field | striped-shield + star | 按 ID 刷新 |
| lum_11_09 | Port d'Aube | 贝勒普兰联盟 | Union Belleplaine | FBEY | FRA | 11 | #86198f | #4d7c0f | 贝勒普兰公园球场 / Belleplaine Park | circle + river | 按 ID 刷新 |
| lum_11_10 | Lac d'Or | 吕米纳克体育会 | Stade Luminac | FLUM | FRA | 11 | #15803d | #1e40af | 吕米纳克球场 / Luminac Ground | shield + peak | 按 ID 刷新 |
| lum_11_11 | Vieux Marche | 欧布瓦尔足球会 | FC Aubeval | FAUB | FRA | 11 | #9f1239 | #9a3412 | 欧布瓦尔竞技场 / Aubeval Arena | diamond + wing | 按 ID 刷新 |
| lum_11_12 | Haute-Rive | 绿岸体育会 | AS Coteverte | FCOB | FRA | 11 | #1e40af | #047857 | 绿岸运动场 / Coteverte Field | hexagon + tree | 按 ID 刷新 |
| lum_11_13 | Moulin Vert | 蒙瑟兰竞速会 | Racing Montserein | FMOC | FRA | 11 | #92400e | #86198f | 蒙瑟兰公园球场 / Montserein Park | striped-shield + tower | 按 ID 刷新 |
| lum_11_14 | Cote Claire | 布瓦鲁联盟 | Union Boisroux | FBOD | FRA | 11 | #6d28d9 | #c026d3 | 布瓦鲁球场 / Boisroux Ground | circle + star | 按 ID 刷新 |
| lum_11_15 | Jardin FC | 里瓦祖尔体育会 | Stade Rivazur | FRIE | FRA | 11 | #166534 | #1d4ed8 | 里瓦祖尔竞技场 / Rivazur Arena | shield + river | 按 ID 刷新 |
| lum_11_16 | Plein-Ciel | 欧特布里兹足球会 | FC Hautebrise | FHAF | FRA | 11 | #c026d3 | #c2410c | 欧特布里兹运动场 / Hautebrise Field | diamond + peak | 按 ID 刷新 |

## 迁移原则

- 保留 internal countryId、leagueId 和 clubId。
- `countryCode` 使用 ENG、ESP、ITA、GER、FRA；内部旧 countryId 只作为兼容键。
- 俱乐部升降级后以当前 `division` 作为 `leagueId`，品牌映射中的 leagueId 仅记录初始归属。
- 旧存档名称、简称、颜色、球衣和队徽快照按 clubId 覆盖；能力、预算、球员、赛程、积分和执教关系不变。
- 未知 clubId 保留原数据作为安全 fallback。
- 历史新闻和比赛报告中的文本快照不强制改写，避免破坏历史记录。
