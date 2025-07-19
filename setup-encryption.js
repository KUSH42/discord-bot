#!/usr/bin/env node

/**
 * Setup script for encrypting sensitive credentials using dotenvx
 * This script helps users encrypt their Twitter credentials and other sensitive data
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import readline from 'readline';

function question(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function checkDotenvxInstalled() {
  return new Promise(resolve => {
    const child = spawn('npx', ['dotenvx', '--version'], { stdio: 'pipe' });
    child.on('close', code => {
      resolve(code === 0);
    });
  });
}

async function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

async function createEnvTemplate() {
  const template = `# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_BOT_SUPPORT_LOG_CHANNEL=your_support_channel_id_here
DISCORD_YOUTUBE_CHANNEL_ID=your_youtube_announcement_channel_id_here
DISCORD_X_POSTS_CHANNEL_ID=your_x_posts_channel_id_here
DISCORD_X_REPLIES_CHANNEL_ID=your_x_replies_channel_id_here
DISCORD_X_QUOTES_CHANNEL_ID=your_x_quotes_channel_id_here
DISCORD_X_RETWEETS_CHANNEL_ID=your_x_retweets_channel_id_here

# YouTube Configuration
YOUTUBE_API_KEY=your_youtube_api_key_here
YOUTUBE_CHANNEL_ID=your_youtube_channel_id_here

# X (Twitter) Configuration - SENSITIVE CREDENTIALS
TWITTER_USERNAME=your_twitter_username_here
TWITTER_PASSWORD=your_twitter_password_here
X_USER_HANDLE=your_x_handle_here

# PubSubHubbub Configuration
PSH_CALLBACK_URL=https://your-domain.com/webhook/youtube
PSH_SECRET=your_webhook_secret_here
PSH_VERIFY_TOKEN=your_verify_token_here

# Optional Configuration (with defaults)
COMMAND_PREFIX=!
PSH_PORT=3000
LOG_FILE_PATH=bot.log
LOG_LEVEL=info
ANNOUNCEMENT_ENABLED=false
X_VX_TWITTER_CONVERSION=false
X_QUERY_INTERVAL_MIN=300000
X_QUERY_INTERVAL_MAX=600000
ANNOUNCE_OLD_TWEETS=false
ALLOWED_USER_IDS=comma,separated,user,ids
`;

  await fs.writeFile('.env.example', template);
  console.log('✅ Created .env.example template');
}

async function main() {
  console.log('🔐 Discord Bot Credential Encryption Setup');
  console.log('==========================================\n');

  // Check if dotenvx is available
  const dotenvxAvailable = await checkDotenvxInstalled();
  if (!dotenvxAvailable) {
    console.error('❌ dotenvx is not available. Make sure @dotenvx/dotenvx is installed.');
    console.log('Run: npm install @dotenvx/dotenvx');
    process.exit(1);
  }

  // Create .env.example if it doesn't exist
  if (!existsSync('.env.example')) {
    await createEnvTemplate();
  }

  console.log('This script will help you set up encrypted credentials for your Discord bot.');
  console.log('');
  console.log('Steps:');
  console.log('1. Create/update your .env file with your credentials');
  console.log('2. Encrypt sensitive credentials using dotenvx');
  console.log('3. Generate a .env.keys file for key management');
  console.log('');

  const proceed = await question('Do you want to proceed? (y/N): ');
  if (proceed.toLowerCase() !== 'y') {
    console.log('Setup cancelled.');
    process.exit(0);
  }

  // Check if .env exists
  if (!existsSync('.env')) {
    console.log('\n❌ .env file not found.');
    console.log('Please create a .env file based on .env.example first.');
    console.log('Copy .env.example to .env and fill in your actual values.');
    process.exit(1);
  }

  console.log('\n🔑 Encrypting sensitive credentials...');

  try {
    // Encrypt sensitive Twitter credentials
    const sensitiveVars = [
      'TWITTER_USERNAME',
      'TWITTER_PASSWORD',
      'DISCORD_BOT_TOKEN',
      'YOUTUBE_API_KEY',
      'PSH_SECRET',
    ];

    for (const varName of sensitiveVars) {
      console.log(`Encrypting ${varName}...`);
      await runCommand('npx', ['dotenvx', 'encrypt', '-k', varName]);
    }

    console.log('\n✅ Encryption complete!');
    console.log('\n📋 Next steps:');
    console.log('1. Your sensitive credentials are now encrypted in .env');
    console.log('2. A .env.keys file has been created with encryption keys');
    console.log('3. Keep .env.keys secure and separate from your code repository');
    console.log('4. The bot will automatically decrypt credentials at runtime');
    console.log('\n🔒 Security Notes:');
    console.log('- Add .env.keys to your .gitignore file');
    console.log('- Store .env.keys securely (separate from code)');
    console.log('- Consider using environment-specific key files for production');
  } catch (error) {
    console.error('\n❌ Encryption failed:', error.message);
    console.log('\nPlease check that your .env file has valid values for the sensitive variables.');
  }
}

main().catch(console.error);
