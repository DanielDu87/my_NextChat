#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BACKUP_DIR = process.argv[2] || '/Users/dyx/Code/NextChat/db-backup-20260514-165123';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://dyx:NrCCTyikNREXjiZ6@host.docker.internal:15432/nextchat'
});

const RESTORE_ORDER = [
  'app_users',
  'conversations', 
  'messages',
  'app_settings',
  'provider_configs',
  'provider_api_keys',
  'auth_sessions',
  'site_access_settings',
  'sync_secrets',
  'user_model_refresh_states'
];

async function restoreTable(tableName, backupData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log(`\n恢复表: ${tableName}`);
    console.log(`  备份记录数: ${backupData.rowCount}`);

    if (backupData.rowCount === 0) {
      console.log(`  跳过空表`);
      await client.query('COMMIT');
      return { inserted: 0, skipped: 0, errors: 0 };
    }

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of backupData.data) {
      try {
        const checkResult = await client.query(
          `SELECT id FROM ${tableName} WHERE id = $1`,
          [row.id]
        );

        if (checkResult.rows.length > 0) {
          skipped++;
          continue;
        }

        const columns = Object.keys(row);
        const values = Object.values(row);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
        const insertQuery = `
          INSERT INTO ${tableName} (${columns.join(', ')})
          VALUES (${placeholders})
        `;

        await client.query(insertQuery, values);
        inserted++;
      } catch (err) {
        console.error(`    错误: ${err.message}`);
        errors++;
      }
    }

    await client.query('COMMIT');
    console.log(`  ✅ 插入: ${inserted}, 跳过: ${skipped}, 错误: ${errors}`);
    
    return { inserted, skipped, errors };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('开始恢复数据库备份...');
    console.log(`备份目录: ${BACKUP_DIR}\n`);

    const totalStats = {
      inserted: 0,
      skipped: 0,
      errors: 0
    };

    for (const tableName of RESTORE_ORDER) {
      const backupFile = path.join(BACKUP_DIR, `${tableName}.json`);
      
      if (!fs.existsSync(backupFile)) {
        console.log(`\n跳过表 ${tableName}: 备份文件不存在`);
        continue;
      }

      const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      const stats = await restoreTable(tableName, backupData);
      
      totalStats.inserted += stats.inserted;
      totalStats.skipped += stats.skipped;
      totalStats.errors += stats.errors;
    }

    console.log('\n========================================');
    console.log('恢复完成！');
    console.log(`总计插入: ${totalStats.inserted}`);
    console.log(`总计跳过: ${totalStats.skipped}`);
    console.log(`总计错误: ${totalStats.errors}`);
    console.log('========================================\n');

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('恢复失败:', err);
    await pool.end();
    process.exit(1);
  }
}

main();
