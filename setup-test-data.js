const fs = require('fs');
const { Client } = require('pg');

const ADMIN_USER_ID = '30764ca3-d589-4ad7-bd20-02fe1c5cc1d2';
const BACKUP_DIR = '/Users/dyx/Code/NextChat/db-backup-20260514-165123';

// 数据库连接配置
const client = new Client({
  host: '127.0.0.1',
  port: 15432,
  database: 'nextchat',
  user: 'postgres',
  password: '',
});

// 为每个用户准备的测试对话内容
const testConversations = {
  admin: [
    { title: '项目管理讨论', messages: [
      { role: 'user', content: '帮我制定一个项目管理计划' },
      { role: 'assistant', content: '好的，我来帮你制定一个项目管理计划...' }
    ]},
    { title: '代码审查要点', messages: [
      { role: 'user', content: '代码审查时应该注意哪些要点？' },
      { role: 'assistant', content: '代码审查时需要注意以下几个要点...' }
    ]},
    { title: '系统架构设计', messages: [
      { role: 'user', content: '如何设计一个高可用的系统架构？' },
      { role: 'assistant', content: '设计高可用系统架构需要考虑以下几个方面...' }
    ]},
    { title: '团队协作技巧', messages: [
      { role: 'user', content: '如何提高团队协作效率？' },
      { role: 'assistant', content: '提高团队协作效率可以从以下几个方面入手...' }
    ]},
    { title: '技术选型建议', messages: [
      { role: 'user', content: '新项目应该如何进行技术选型？' },
      { role: 'assistant', content: '技术选型需要综合考虑多个因素...' }
    ]}
  ],
  ddd: [
    { title: 'Python 学习路线', messages: [
      { role: 'user', content: '我想学习 Python，应该从哪里开始？' },
      { role: 'assistant', content: 'Python 学习可以从基础语法开始...' }
    ]},
    { title: '数据分析入门', messages: [
      { role: 'user', content: '数据分析需要掌握哪些技能？' },
      { role: 'assistant', content: '数据分析需要掌握统计学、编程和可视化等技能...' }
    ]},
    { title: '机器学习基础', messages: [
      { role: 'user', content: '机器学习的基本概念是什么？' },
      { role: 'assistant', content: '机器学习是让计算机从数据中学习的技术...' }
    ]},
    { title: 'Web 开发指南', messages: [
      { role: 'user', content: 'Web 开发需要学习哪些技术？' },
      { role: 'assistant', content: 'Web 开发需要学习 HTML、CSS、JavaScript 等...' }
    ]},
    { title: '算法练习题', messages: [
      { role: 'user', content: '推荐一些算法练习题' },
      { role: 'assistant', content: '我推荐从 LeetCode 的简单题开始...' }
    ]}
  ],
  asdsa: [
    { title: '产品需求分析', messages: [
      { role: 'user', content: '如何进行产品需求分析？' },
      { role: 'assistant', content: '产品需求分析需要从用户痛点出发...' }
    ]},
    { title: '用户体验优化', messages: [
      { role: 'user', content: '如何优化用户体验？' },
      { role: 'assistant', content: '用户体验优化可以从界面设计、交互流程等方面入手...' }
    ]},
    { title: '市场调研方法', messages: [
      { role: 'user', content: '市场调研有哪些方法？' },
      { role: 'assistant', content: '市场调研可以采用问卷调查、用户访谈等方法...' }
    ]},
    { title: '竞品分析报告', messages: [
      { role: 'user', content: '如何撰写竞品分析报告？' },
      { role: 'assistant', content: '竞品分析报告应该包括产品功能、用户群体、商业模式等...' }
    ]},
    { title: '产品迭代计划', messages: [
      { role: 'user', content: '如何制定产品迭代计划？' },
      { role: 'assistant', content: '产品迭代计划需要根据用户反馈和数据分析来制定...' }
    ]}
  ],
  cccc: [
    { title: '运营策略制定', messages: [
      { role: 'user', content: '如何制定有效的运营策略？' },
      { role: 'assistant', content: '运营策略需要结合产品特点和目标用户...' }
    ]},
    { title: '内容营销技巧', messages: [
      { role: 'user', content: '内容营销有哪些技巧？' },
      { role: 'assistant', content: '内容营销需要注重内容质量和传播渠道...' }
    ]},
    { title: '用户增长方案', messages: [
      { role: 'user', content: '如何实现用户快速增长？' },
      { role: 'assistant', content: '用户增长可以通过裂变、广告投放等方式...' }
    ]},
    { title: '数据分析报告', messages: [
      { role: 'user', content: '如何撰写数据分析报告？' },
      { role: 'assistant', content: '数据分析报告应该包括数据来源、分析方法、结论建议等...' }
    ]},
    { title: '活动策划方案', messages: [
      { role: 'user', content: '如何策划一场成功的活动？' },
      { role: 'assistant', content: '活动策划需要明确目标、预算、执行方案等...' }
    ]}
  ],
  ccc: [
    { title: '设计规范制定', messages: [
      { role: 'user', content: '如何制定设计规范？' },
      { role: 'assistant', content: '设计规范应该包括颜色、字体、间距等标准...' }
    ]},
    { title: 'UI 设计技巧', messages: [
      { role: 'user', content: 'UI 设计有哪些技巧？' },
      { role: 'assistant', content: 'UI 设计需要注重视觉层次、对比度、留白等...' }
    ]},
    { title: '交互设计原则', messages: [
      { role: 'user', content: '交互设计的基本原则是什么？' },
      { role: 'assistant', content: '交互设计需要遵循一致性、反馈、容错等原则...' }
    ]},
    { title: '设计工具推荐', messages: [
      { role: 'user', content: '推荐一些设计工具' },
      { role: 'assistant', content: '常用的设计工具有 Figma、Sketch、Adobe XD 等...' }
    ]},
    { title: '设计趋势分析', messages: [
      { role: 'user', content: '当前的设计趋势是什么？' },
      { role: 'assistant', content: '当前设计趋势包括极简主义、暗黑模式、3D 元素等...' }
    ]}
  ]
};

async function main() {
  try {
    await client.connect();
    console.log('✅ 数据库连接成功');

    // 1. 读取备份的对话数据
    console.log('\n📖 读取备份数据...');
    const backupConversations = JSON.parse(
      fs.readFileSync(`${BACKUP_DIR}/conversations.json`, 'utf8')
    );
    const backupMessages = JSON.parse(
      fs.readFileSync(`${BACKUP_DIR}/messages.json`, 'utf8')
    );

    console.log(`备份中有 ${backupConversations.data.length} 个对话`);
    console.log(`备份中有 ${backupMessages.data.length} 条消息`);

    // 2. 将备份的对话导入到 admin 账号
    console.log('\n📥 导入备份对话到 admin 账号...');
    let importedCount = 0;

    for (const conv of backupConversations.data) {
      // 检查对话是否已存在
      const existingConv = await client.query(
        'SELECT id FROM conversations WHERE external_session_id = $1',
        [conv.external_session_id]
      );

      if (existingConv.rows.length > 0) {
        console.log(`⏭️  对话 ${conv.title} 已存在，跳过`);
        continue;
      }

      // 插入对话
      const result = await client.query(
        `INSERT INTO conversations (
          id, user_id, external_session_id, title, model_name,
          provider_name, metadata_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
        RETURNING id`,
        [
          conv.id,
          ADMIN_USER_ID,
          conv.external_session_id,
          conv.title,
          conv.model_name,
          conv.provider_name,
          conv.metadata_json,
          conv.created_at,
          conv.updated_at
        ]
      );

      if (result.rows.length > 0) {
        // 导入该对话的消息
        const convMessages = backupMessages.data.filter(
          m => m.conversation_id === conv.id
        );

        for (const msg of convMessages) {
          await client.query(
            `INSERT INTO messages (
              id, conversation_id, external_message_id, seq, role,
              content_text, content_json, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING`,
            [
              msg.id,
              msg.conversation_id,
              msg.external_message_id,
              msg.seq,
              msg.role,
              msg.content_text,
              msg.content_json,
              msg.created_at,
              msg.updated_at
            ]
          );
        }

        importedCount++;
        console.log(`✅ 导入对话: ${conv.title} (${convMessages.length} 条消息)`);
      }
    }

    console.log(`\n✅ 共导入 ${importedCount} 个对话`);

    // 3. 获取所有用户
    const usersResult = await client.query(
      'SELECT id, username FROM app_users ORDER BY created_at'
    );
    const users = usersResult.rows;

    console.log(`\n👥 找到 ${users.length} 个用户`);

    // 4. 为每个用户创建 5 个测试对话
    console.log('\n📝 为每个用户创建测试对话...');

    for (const user of users) {
      const username = user.username;
      const conversations = testConversations[username] || testConversations.admin;

      console.log(`\n为用户 ${username} 创建对话...`);

      for (let i = 0; i < conversations.length; i++) {
        const conv = conversations[i];
        const sessionId = `test_${username}_${Date.now()}_${i}`;

        // 创建对话
        const convResult = await client.query(
          `INSERT INTO conversations (
            user_id, external_session_id, title, model_name,
            provider_name, metadata_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING id`,
          [
            user.id,
            sessionId,
            conv.title,
            'gpt-4',
            'OpenAI',
            JSON.stringify({
              id: sessionId,
              topic: conv.title,
              createdAt: Date.now(),
              lastUpdate: Date.now()
            })
          ]
        );

        const conversationId = convResult.rows[0].id;

        // 创建消息
        for (let j = 0; j < conv.messages.length; j++) {
          const msg = conv.messages[j];
          await client.query(
            `INSERT INTO messages (
              conversation_id, seq, role, content_text, content_json,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [
              conversationId,
              j,
              msg.role,
              msg.content,
              JSON.stringify({ role: msg.role, content: msg.content })
            ]
          );
        }

        console.log(`  ✅ 创建对话: ${conv.title}`);
      }
    }

    console.log('\n✅ 所有测试数据创建完成！');

    // 5. 统计结果
    const stats = await client.query(`
      SELECT
        u.username,
        COUNT(c.id) as conversation_count,
        COUNT(m.id) as message_count
      FROM app_users u
      LEFT JOIN conversations c ON c.user_id = u.id
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY u.id, u.username
      ORDER BY u.username
    `);

    console.log('\n📊 数据统计:');
    console.log('用户名\t\t对话数\t消息数');
    console.log('----------------------------------------');
    for (const row of stats.rows) {
      console.log(`${row.username}\t\t${row.conversation_count}\t${row.message_count}`);
    }

  } catch (error) {
    console.error('❌ 错误:', error);
  } finally {
    await client.end();
  }
}

main();
