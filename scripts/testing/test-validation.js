// test-validation.js - Environment validation before startup
import { config } from '@dotenvx/dotenvx';
import { validateEnvironmentVariables } from '../../src/env-validator.js';

// Load environment variables
config();

console.log('🔍 Validating environment configuration...');

try {
  const validation = validateEnvironmentVariables();

  if (validation.success) {
    console.log('✅ Environment validation passed');
    process.exit(0);
  } else {
    console.error('❌ Environment validation failed:');
    validation.issues.forEach(issue => {
      console.error(`  - ${issue}`);
    });
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Validation error:', error.message);
  process.exit(1);
}
