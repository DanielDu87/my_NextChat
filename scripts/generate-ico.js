#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const iconsDir = path.join(__dirname, '../public/provider-icons');

// 需要生成的 ico 文件及其配置
const icons = [
  { name: 'anthropic', color: '#D4915D', text: 'A' },
  { name: 'bytedance', color: '#2563EB', text: '字节' },
  { name: 'google', color: '#4285F4', text: 'G' },
  { name: 'xai', color: '#000000', text: 'X' },
  { name: 'groq-official', color: '#FF5500', text: 'G' },
  { name: 'meta-official', color: '#0668E1', text: 'M' },
  { name: 'qwen-official', color: '#6B7280', text: 'Q' },
  { name: 'fireworks-official', color: '#FF6B35', text: 'F' },
  { name: 'inclusionai-official', color: '#8B5CF6', text: 'I' },
  { name: 'together-official', color: '#7C3AED', text: 'T' },
  { name: 'upstage-official', color: '#10B981', text: 'U' },
  { name: 'yuto-official', color: '#F59E0B', text: 'Y' },
];

// 创建一个简单的 PNG 图标（可以作为 ico 使用）
function createIcon(name, color, text) {
  const size = 32;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 背景
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 6);
  ctx.fill();

  // 文字
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 1);

  return canvas.toBuffer('image/png');
}

async function main() {
  for (const icon of icons) {
    const destPath = path.join(iconsDir, `${icon.name}.ico`);

    // 跳过已存在的文件
    if (fs.existsSync(destPath)) {
      console.log(`✓ ${icon.name}.ico already exists`);
      continue;
    }

    try {
      // 创建图标（保存为 PNG 格式但使用 .ico 扩展名，浏览器可以识别）
      const buffer = createIcon(icon.name, icon.color, icon.text);
      fs.writeFileSync(destPath, buffer);
      console.log(`✓ Created ${icon.name}.ico`);
    } catch (err) {
      console.error(`✗ Failed to create ${icon.name}.ico:`, err.message);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
