#!/usr/bin/env node

/**
 * Setup script for encrypting sensitive credentials using dotenvx
 * This script helps users encrypt their Twitter credentials and other sensitive data
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import readline from 'readline';
import path from 'path'; // Import the 'path' module

/**
 * Prompts the user with a question and returns their answer.
 * @param {string} prompt The question to ask the user.
 * @returns {Promise<string>} A promise that resolves with the user's answer.
 */
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

/**
 * Checks if dotenvx is installed and available via npx.
 * @returns {Promise<boolean>} True if dotenvx is available, false otherwise.
 */
async function checkDotenvxInstalled() {
  return new Promise(resolve => {
    // Use 'pipe' for stdio to prevent npx output from polluting the console directly
    const child = spawn('npx', ['dotenvx', '--version'], { stdio: 'pipe' });
    child.on('close', code => {
      resolve(code === 0);
    });
    // Handle errors like command not found
    child.on('error', err => {
      console.error(`Failed to start npx: ${err.message}`);
      resolve(false);
    });
  });
}

/**
 * Runs a shell command and pipes its output to the console.
 * @param {string} command The command to run.
 * @param {string[]} args Arguments for the command.
 * @returns {Promise<void>} A promise that resolves if the command succeeds, rejects otherwise.
 */
async function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command '${command} ${args.join(' ')}' failed with exit code ${code}`));
      }
    });
    child.on('error', err => {
      reject(new Error(`Failed to start command '${command}': ${err.message}`));
    });
  });
}

/**
 * Parses the content of an .env file into a structured array.
 * Each item represents a line, categorised as 'variable', 'comment', or 'empty'.
 * @param {string} content The raw string content of the .env file.
 * @returns {Array<{ type: 'variable' | 'comment' | 'empty', raw: string, key?: string, value?: string }>}
 */
function parseEnvLines(content) {
  const lines = content.split(/\r?\n/);
  return lines.map(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#')) {
      return { type: 'comment', raw: line };
    } else if (trimmedLine === '') {
      return { type: 'empty', raw: line };
    } else {
      const equalsIndex = line.indexOf('=');
      if (equalsIndex > -1) {
        const key = line.substring(0, equalsIndex).trim();
        const value = line.substring(equalsIndex + 1); // Keep original value, as it might contain spaces/quotes
        return { type: 'variable', raw: line, key, value };
      } else {
        // Line without an equals sign might still be a variable assignment or invalid
        // Treat as an empty line if no assignment is found, to avoid breaking output
        return { type: 'empty', raw: line };
      }
    }
  });
}

/**
 * Creates or updates the .env.example file.
 * If a ../.env.example exists, its content is used as the template.
 * Otherwise, a default hardcoded template is used.
 */
async function createOrUpdateEnvExample() {
  const defaultTemplate = `# Discord Bot Configuration
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

# YouTube Authentication (Optional - for scraper enhancement)
YOUTUBE_AUTHENTICATION_ENABLED=true
YOUTUBE_USERNAME=your_youtube_email_here
YOUTUBE_PASSWORD=your_youtube_password_here

# YouTube Fallback Configuration
YOUTUBE_FALLBACK_ENABLED=true
YOUTUBE_FALLBACK_DELAY_MS=15000
YOUTUBE_FALLBACK_MAX_RETRIES=3
YOUTUBE_API_POLL_INTERVAL_MS=60000

# YouTube Scraper Polling Delays
YOUTUBE_CHANNEL_HANDLE="YourChannelHandle"
YOUTUBE_SCRAPER_INTERVAL_MIN="30000"
YOUTUBE_SCRAPER_INTERVAL_MAX="60000"

# X (Twitter) Configuration - SENSITIVE CREDENTIALS
TWITTER_USERNAME=your_twitter_username_here
TWITTER_EMAIL=your_twitter_email_here
TWITTER_PASSWORD=your_twitter_password_here
X_USER_HANDLE=your_x_handle_here
X_QUERY_INTERVALL_MIN=300000
X_QUERY_INTERVALL_MAX=600000
X_VX_TWITTER_CONVERSION=true
ANNOUNCE_OLD_TWEETS=false

# PubSubHubbub Configuration
PSH_CALLBACK_URL=https://your-domain.com/webhook/youtube
PSH_PORT=3000
PSH_SECRET=your_webhook_secret_here
PSH_VERIFY_TOKEN=your_verify_token_here

# Optional Configuration (with defaults)
COMMAND_PREFIX=!
LOG_FILE_PATH=bot.log
LOG_LEVEL=info
SYSTEMD_SERVICE_NAME=discord-bot.service
ANNOUNCEMENT_ENABLED=true
X_VX_TWITTER_CONVERSION=true
ALLOWED_USER_IDS=comma,separated,user,ids

# Content Detection Reliability Configuration
MAX_CONTENT_AGE_HOURS=2
ENABLE_CONTENT_FINGERPRINTING=true
ENABLE_LIVESTREAM_MONITORING=true
ENABLE_CROSS_VALIDATION=true
CONTENT_STORAGE_DIR=data
DUPLICATE_CLEANUP_INTERVAL_HOURS=24
LIVESTREAM_POLLING_INTERVAL_MS=30000
WEBHOOK_MAX_RETRIES=3
PROCESSING_LOCK_TIMEOUT_MS=30000

# Browser Anti-Detection Configuration
BROWSER_STEALTH_ENABLED=true
BEHAVIOR_SIMULATION_ENABLED=false
BROWSER_HEADLESS=false
USER_AGENT_ROTATION_INTERVAL=3600000
INTELLIGENT_RATE_LIMITING=false
MIN_REQUEST_INTERVAL=30000
MAX_REQUEST_INTERVAL=300000
BROWSER_PROFILE_PERSISTENCE=true
BROWSER_PROFILE_DIR=./browser-profiles

# Detection Monitoring Configuration
DETECTION_MONITORING_ENABLED=false
DETECTION_ALERT_THRESHOLD=3
DETECTION_MONITORING_WINDOW=3600000

# Performance Monitoring Configuration
PERFORMANCE_MONITORING_ENABLED=true
PERFORMANCE_SAMPLING_INTERVAL=30000
PERFORMANCE_MEMORY_THRESHOLD=1073741824
PERFORMANCE_CPU_THRESHOLD=80
PERFORMANCE_RESPONSE_TIME_THRESHOLD=30000

# Human Behavior Simulation Configuration
MOUSE_MOVEMENT_ENABLED=true
SCROLLING_SIMULATION_ENABLED=true
READING_TIME_SIMULATION=false
INTERACTION_SIMULATION_ENABLED=false

# Advanced Rate Limiting Configuration
RATE_LIMITER_BURST_THRESHOLD=8
RATE_LIMITER_MAX_PENALTY=1.5
RATE_LIMITER_PENALTY_DECAY_TIME=1800000

# Browser Profile Management
PROFILE_CLEANUP_ENABLED=true
PROFILE_MAX_AGE_DAYS=7
PROFILE_SESSION_TIMEOUT=86400000

# Debugging Configuration
WEBHOOK_DEBUG_LOGGING=true
STEALTH_DEBUG_LOGGING=false
`;

  const customTemplatePath = path.resolve('../.env.example'); // Path to the parent directory's .env.example
  let templateToUse = defaultTemplate;

  // Check if a custom .env.example exists in the parent directory
  if (existsSync(customTemplatePath)) {
    console.log(`Found existing template at '${customTemplatePath}'. Using its content for .env.example.`);
    templateToUse = await fs.readFile(customTemplatePath, 'utf8');
  } else {
    console.log(`No custom template found at '${customTemplatePath}'. Using default template for .env.example.`);
  }

  // Write the chosen template to ./.env.example (in the current directory)
  await fs.writeFile('.env.example', templateToUse);
  console.log('✅ Created/Updated .env.example template');
}

/**
 * Updates the existing .env file by adding missing fields from .env.example
 * and preserving existing values and their order.
 * Appends any unique variables from the original .env at the end.
 * @param {string} envExampleContent The content of the .env.example file.
 * @returns {Promise<string[]>} A promise that resolves with an array of keys of newly added variables.
 */
async function updateExistingEnv(envExampleContent) {
  const currentEnvContent = await fs.readFile('.env', 'utf8');

  const parsedExample = parseEnvLines(envExampleContent);
  const parsedCurrent = parseEnvLines(currentEnvContent);

  const currentEnvValuesMap = new Map(); // Map for quick lookup of current .env values
  for (const item of parsedCurrent) {
    if (item.type === 'variable') {
      currentEnvValuesMap.set(item.key, item.value);
    }
  }

  const newEnvLines = [];
  const handledKeysFromCurrent = new Set(); // To track keys from current .env that have been processed
  const newlyAddedVariables = []; // To store keys of variables added from .env.example

  // Phase 1: Build the new content based on .env.example's structure
  for (const item of parsedExample) {
    if (item.type === 'variable') {
      if (currentEnvValuesMap.has(item.key)) {
        // Use the existing value from .env
        newEnvLines.push(`${item.key}=${currentEnvValuesMap.get(item.key)}`);
        handledKeysFromCurrent.add(item.key);
      } else {
        // Add the missing variable with its default value from .env.example
        newEnvLines.push(item.raw);
        newlyAddedVariables.push(item.key); // Mark as newly added
      }
    } else {
      // Preserve comments and empty lines from .env.example
      newEnvLines.push(item.raw);
    }
  }

  // Phase 2: Append any unique variables from the original .env that were not in .env.example
  let customVarsSectionAdded = false;
  for (const item of parsedCurrent) {
    if (item.type === 'variable' && !handledKeysFromCurrent.has(item.key)) {
      if (!customVarsSectionAdded) {
        newEnvLines.push('\n# Custom variables (not found in .env.example)');
        customVarsSectionAdded = true;
      }
      newEnvLines.push(item.raw); // Add the original line from .env
    }
  }

  await fs.writeFile('.env', newEnvLines.join('\n'));
  console.log('✅ .env file updated with missing fields from .env.example.');

  return newlyAddedVariables; // Return the list of newly added variables
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

  // First, ensure .env.example exists (or is created from ../.env.example or default)
  await createOrUpdateEnvExample();
  const envExampleContent = await fs.readFile('.env.example', 'utf8'); // Read the actual .env.example content

  console.log(
    'This script will help you set up encrypted credentials for your Discord bot, YouTube, and X (formerly Twitter) integrations.'
  );
  console.log('');
  console.log('Steps:');
  console.log('1. Create/update your .env file with your credentials.');
  console.log('2. Encrypt sensitive credentials using dotenvx.');
  console.log('3. Generate a .env.keys file for key management.');
  console.log('');

  const proceed = await question('Do you want to proceed? (y/N): ');
  if (proceed.toLowerCase() !== 'y') {
    console.log('Setup cancelled.');
    process.exit(0);
  }

  const envExists = existsSync('.env');
  let newlyAdded = [];

  if (!envExists) {
    console.log('\n❌ .env file not found.');
    const createNow = await question('Would you like to create a new .env file based on .env.example? (y/N): ');
    if (createNow.toLowerCase() === 'y') {
      await fs.copyFile('.env.example', '.env');
      // All variables in .env will be "newly added" from the example if .env didn't exist
      newlyAdded = parseEnvLines(envExampleContent)
        .filter(item => item.type === 'variable')
        .map(item => item.key);
      console.log(
        '✅ Created .env file from .env.example. Please fill in your actual values for the following variables:'
      );
      newlyAdded.forEach(key => console.log(`- ${key}`));
    } else {
      console.log('Skipping .env creation. Please create it manually to proceed with encryption.');
      process.exit(0);
    }
  } else {
    console.log('✅ .env file found.');
    const updateOption = await question(
      'A .env file already exists. Do you want to update it with missing fields from .env.example? (y/N): '
    );
    if (updateOption.toLowerCase() === 'y') {
      newlyAdded = await updateExistingEnv(envExampleContent);
      if (newlyAdded.length > 0) {
        console.log('\nThe following new variables were added to your .env file from .env.example:');
        newlyAdded.forEach(key => console.log(`- ${key}`));
        console.log('\nPlease fill in their values.');
      } else {
        console.log('\nNo new variables were added to your .env file. It is already up-to-date with .env.example.');
      }
    } else {
      console.log('Skipping .env update. Proceeding with existing .env content.');
    }
  }

  console.log('\n🔑 Encrypting sensitive credentials...');

  try {
    // Define sensitive variables based on the updated template
    const sensitiveVars = [
      'DISCORD_BOT_TOKEN',
      'YOUTUBE_API_KEY',
      'YOUTUBE_USERNAME',
      'YOUTUBE_PASSWORD',
      'TWITTER_USERNAME',
      'TWITTER_EMAIL',
      'TWITTER_PASSWORD',
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
    process.exit(1); // Exit with error code if encryption fails
  }
}

main().catch(error => {
  console.error('\nAn unexpected error occurred:', error.message);
  process.exit(1);
});
