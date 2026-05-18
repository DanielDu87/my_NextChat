#!/usr/bin/env node

/**
 * 为每个非 admin 用户创建 5 个测试对话
 * 通过 NextChat API 直接操作数据库
 */

import { Pool } from "pg";

const DATABASE_URL =
  "postgresql://dyx:NrCCTyikNREXjiZ6@localhost:15432/nextchat";

const TEST_CONVERSATIONS = [
  {
    title: "日常聊天测试",
    model: "gpt-4o",
    messages: [
      { role: "user", content: "你好，今天天气怎么样？" },
      {
        role: "assistant",
        content:
          "你好！我无法获取实时天气信息，不过你可以查看天气预报应用获取最新的天气情况。有什么其他我可以帮助你的吗？",
      },
    ],
  },
  {
    title: "代码辅助讨论",
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: "帮我写一个 JavaScript 防抖函数",
      },
      {
        role: "assistant",
        content:
          "这是一个经典的防抖函数实现：\n\n```javascript\nfunction debounce(fn, delay) {\n  let timer = null;\n  return function (...args) {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn.apply(this, args), delay);\n  };\n}\n```\n\n每次调用时都会清除之前的定时器并重新计时，只有最后一次调用后的 delay 毫秒才会真正执行函数。",
      },
      { role: "user", content: "能加个立即执行的功能吗？" },
      {
        role: "assistant",
        content:
          "可以，加上 `immediate` 参数：\n\n```javascript\nfunction debounce(fn, delay, immediate = false) {\n  let timer = null;\n  return function (...args) {\n    clearTimeout(timer);\n    if (immediate && !timer) {\n      fn.apply(this, args);\n    }\n    timer = setTimeout(() => {\n      if (!immediate) fn.apply(this, args);\n      timer = null;\n    }, delay);\n  };\n}\n```\n\n`immediate = true` 时首次调用立即执行，之后在 delay 时间内不会重复触发。",
      },
    ],
  },
  {
    title: "学习笔记整理",
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: "帮我总结一下 React Hooks 的核心概念",
      },
      {
        role: "assistant",
        content:
          "React Hooks 核心概念总结：\n\n1. **useState** — 状态管理，返回 [state, setter] 元组\n2. **useEffect** — 副作用处理，类似 componentDidMount/Update/WillUnmount\n3. **useContext** — 跨组件共享状态，避免 prop drilling\n4. **useReducer** — 复杂状态逻辑，类似 Redux 的 reducer 模式\n5. **useMemo / useCallback** — 性能优化，缓存计算结果和函数引用\n6. **useRef** — 持久引用，不触发重渲染\n7. **自定义 Hook** — 逻辑复用，以 use 开头的函数\n\n核心规则：只在顶层调用 Hook，只在函数组件或自定义 Hook 中调用。",
      },
    ],
  },
  {
    title: "美食推荐",
    model: "gpt-4o",
    messages: [
      { role: "user", content: "推荐几道简单快手的家常菜" },
      {
        role: "assistant",
        content:
          "推荐 5 道 15 分钟内搞定的家常菜：\n\n1. **番茄炒蛋** — 经典下饭菜，5 分钟出锅\n2. **蒜蓉西兰花** — 健康清爽，焯水翻炒即可\n3. **可乐鸡翅** — 零失败，可乐就是灵魂调料\n4. **酸辣土豆丝** — 开胃下饭，切好泡水去淀粉\n5. **蛋炒饭** — 隔夜饭最佳，加点酱油就很香\n\n食材都很常见，适合新手入门！",
      },
      { role: "user", content: "番茄炒蛋有什么小技巧吗？" },
      {
        role: "assistant",
        content:
          "番茄炒蛋的几个关键技巧：\n\n1. **番茄去皮** — 顶部划十字，开水烫 30 秒轻松剥皮\n2. **先炒蛋后炒番茄** — 鸡蛋七分熟先盛出，最后再混合\n3. **加一点糖** — 中和番茄的酸味，味道更鲜\n4. **大火快炒** — 保持番茄的形状和口感\n5. **蛋液加水** — 打蛋时加 1 勺水，炒出来更嫩滑",
      },
    ],
  },
  {
    title: "旅行规划",
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: "帮我规划一个 3 天的东京自由行",
      },
      {
        role: "assistant",
        content:
          "东京 3 天自由行推荐路线：\n\n**Day 1 — 经典地标**\n- 上午：浅草寺、仲见世通\n- 下午：东京晴空塔 → 秋叶原\n- 晚上：银座逛街\n\n**Day 2 — 文化体验**\n- 上午：明治神宫、原宿竹下通\n- 下午：涩谷十字路口 → 涩谷 Sky\n- 晚上：新宿歌舞伎町、思い出横丁\n\n**Day 3 — 自由探索**\n- 上午：筑地场外市场（寿司早餐）\n- 下午：台场海滨公园、teamLab\n- 晚上：东京塔夜景\n\n交通建议：买 Suica 卡或 72 小时地铁通票。",
      },
    ],
  },
];

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // 获取所有非 admin 用户
    const { rows: users } = await pool.query(
      "SELECT id::text, username, display_name, role FROM app_users WHERE username IS NOT NULL ORDER BY role, username"
    );

    console.log(`找到 ${users.length} 个用户：`);
    users.forEach((u) =>
      console.log(`  - ${u.username} (${u.display_name}, ${u.role})`)
    );

    const targetUsers = users.filter((u) => u.username !== "admin");
    console.log(`\n将为 ${targetUsers.length} 个非 admin 用户创建测试对话\n`);

    for (const user of targetUsers) {
      // 清除该用户的旧对话
      await pool.query(
        "DELETE FROM conversations WHERE user_id = $1::uuid",
        [user.id]
      );
      console.log(`  🧹 已清除用户 ${user.username} 的旧对话`);

      for (let i = 0; i < TEST_CONVERSATIONS.length; i++) {
        const conv = TEST_CONVERSATIONS[i];
        const title = `[${user.username}] ${conv.title}`;
        const externalSessionId = `test_${user.username}_${Date.now()}_${i}`;
        const now = Date.now();
        const createdAt = now - (TEST_CONVERSATIONS.length - i) * 3600000;
        const lastUpdate = createdAt + conv.messages.length * 60000;

        const metadataJson = {
          id: externalSessionId,
          topic: title,
          createdAt,
          lastUpdate,
          model: conv.model,
          _syncIndexOrder: i,
          _syncMessageCount: conv.messages.length,
          mask: {
            modelConfig: {
              model: conv.model,
            },
          },
        };

        // 创建对话
        const { rows: [newConv] } = await pool.query(
          `INSERT INTO conversations (user_id, external_session_id, title, model_name, conversation_type, metadata_json)
           VALUES ($1::uuid, $2, $3, $4, 'chat', $5::jsonb)
           RETURNING id::text`,
          [
            user.id,
            externalSessionId,
            title,
            conv.model,
            JSON.stringify(metadataJson),
          ]
        );

        // 创建消息
        for (let j = 0; j < conv.messages.length; j++) {
          const msg = conv.messages[j];
          const msgJson = {
            id: `${externalSessionId}_msg_${j}`,
            role: msg.role,
            content: msg.content,
            date: new Date(createdAt + j * 30000).toISOString(),
          };
          await pool.query(
            `INSERT INTO messages (conversation_id, seq, role, content_text, content_json)
             VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
            [
              newConv.id,
              j + 1,
              msg.role,
              msg.content,
              JSON.stringify(msgJson),
            ]
          );
        }

        console.log(
          `  ✅ [${user.username}] 创建对话「${conv.title}」(${conv.messages.length} 条消息)`
        );
      }
      console.log(`  📋 用户 ${user.username} 共创建 5 个测试对话\n`);
    }

    console.log("🎉 测试数据创建完成！");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ 错误:", err);
  process.exit(1);
});
