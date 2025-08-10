// This script runs before your tests, loading the correct environment file.
// Note: I'm putting this in a `scripts` directory for organization.
import { config } from '@dotenvx/dotenvx';
config({ path: './tests/test.env' });
