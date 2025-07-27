# ESLint Timezone Safety Rules

This project includes custom ESLint rules to prevent timezone-related bugs by enforcing UTC timestamp usage throughout the codebase.

## Rules

### `timezone-safety/enforce-utc-timestamps`

**Type**: Error  
**Fixable**: Yes (auto-fix available)

Enforces the use of UTC methods instead of local timezone methods to ensure consistent behavior across different server timezones.

**Note**: `Date.now()` is exempt from this rule as it returns UTC milliseconds and is timezone-safe. The rule focuses on dangerous methods like `getHours()`, `toLocaleString()`, and `Date.parse()`.

#### ❌ Problematic Code

```javascript
const date = new Date();
const hour = date.getHours();           // Error: use getUTCHours()
const day = date.getDay();              // Error: use getUTCDay()
date.setHours(14);                      // Error: use setUTCHours()
const str = date.toLocaleString();      // Error: use toISOString()

// Note: Date.now() is actually timezone-safe and allowed
const timestamp = Date.now();           // ✓ Safe: returns UTC milliseconds

// Problematic for timestamp storage context
const data = {
  timestamp: new Date(),                // Error: use nowUTC() for clarity
  createdAt: new Date()                 // Error: use nowUTC() for clarity
};
```

#### ✅ Correct Code

```javascript
import { nowUTC, getCurrentHourUTC } from '../utilities/utc-time.js';

const date = new Date();
const hour = date.getUTCHours();        // ✓ UTC method
const day = date.getUTCDay();           // ✓ UTC method
date.setUTCHours(14);                   // ✓ UTC method
const str = date.toISOString();         // ✓ UTC string format

// Timestamp operations - multiple valid approaches
const timestamp1 = Date.now();          // ✓ UTC milliseconds (timezone-safe)
const timestamp2 = timestampUTC();      // ✓ UTC utility wrapper
const timestamp3 = nowUTC().getTime();  // ✓ UTC utility method

// Timestamp storage
const data = {
  timestamp: nowUTC(),                  // ✓ UTC utility for clarity
  createdAt: Date.now()                 // ✓ Also valid (UTC milliseconds)
};

// Or using UTC methods directly
const data2 = {
  timestamp: new Date().toISOString(),  // ✓ UTC string
  hour: getCurrentHourUTC()             // ✓ UTC utility
};
```

### `timezone-safety/require-utc-imports`

**Type**: Warning  
**Fixable**: No

Suggests importing UTC utility functions when performing date operations to encourage consistent patterns.

#### ❌ Missing Import

```javascript
// File uses UTC methods but doesn't import utilities
const hour = new Date().getUTCHours();
const timestamp = new Date().toISOString();
```

#### ✅ With Import

```javascript
import { nowUTC, getCurrentHourUTC, toISOStringUTC } from '../utilities/utc-time.js';

const hour = getCurrentHourUTC();       // ✓ Using utility
const timestamp = toISOStringUTC();     // ✓ Using utility
```

## Exceptions

These rules are automatically disabled for:
- Test files (`*.test.js`, files in `/tests/`)
- Documentation files (`*.md`, files in `/docs/`)
- Configuration files

## Available UTC Utilities

The project provides these UTC utility functions in `src/utilities/utc-time.js`:

```javascript
// Current time functions
nowUTC()                    // Current UTC Date object
timestampUTC()              // Current UTC timestamp (ms) - same as Date.now()
toISOStringUTC()            // Current UTC ISO string

// Time component functions  
getCurrentHourUTC()         // UTC hour (0-23)
getCurrentDayUTC()          // UTC day of week (0-6)
isNightTimeUTC()           // True if UTC night time
isWeekendUTC()             // True if UTC weekend

// Time arithmetic functions
daysAgoUTC(n)              // UTC Date n days ago
hoursAgoUTC(n)             // UTC Date n hours ago
minutesAgoUTC(n)           // UTC Date n minutes ago
secondsAgoUTC(n)           // UTC Date n seconds ago

// Conversion functions
dateFromTimestamp(ms)       // Date from timestamp
parseISOString(iso)         // Date from ISO string
dateToISOString(date)       // Date to ISO string
```

## Running the Rules

The rules are automatically enabled in the ESLint configuration. To check for violations:

```bash
# Check all files
npm run lint

# Check specific file
npx eslint src/application/scraper-application.js

# Auto-fix where possible
npm run lint:fix
```

## Example Violation Output

```
error: Use UTC methods instead of local timezone methods. Use getUTCHours instead (timezone-safety/enforce-utc-timestamps)
  → src/application/scraper-application.js:45:23
    43 |   calculateNextInterval() {
    44 |     const currentHour = new Date().getHours();
       |                                    ^^^^^^^^
    45 |     const isWeekend = [0, 6].includes(new Date().getDay());
       |                                                   ^^^^^^

warning: Import UTC utility functions when performing date operations. Add: import { nowUTC, getCurrentHourUTC } from "../utilities/utc-time.js" (timezone-safety/require-utc-imports)
```

## What's Actually Enforced

The ESLint rules specifically target these dangerous timezone-dependent operations:

**❌ Always Flagged:**
- `getHours()`, `getMinutes()`, `getDay()`, etc. (use UTC equivalents)
- `setHours()`, `setMinutes()`, `setDate()`, etc. (use UTC equivalents) 
- `toLocaleString()`, `toLocaleDateString()` (use `toISOString()`)
- `Date.parse()` (can be timezone-dependent)

**✅ Always Safe:**
- `Date.now()` - returns UTC milliseconds, timezone-agnostic
- `toISOString()` - always UTC format
- `getUTCHours()`, `getUTCDay()`, etc. - explicit UTC methods
- `getTime()`, `valueOf()` - return UTC milliseconds

## Benefits

1. **Consistency**: Ensures all timestamp operations use UTC regardless of server timezone
2. **Bug Prevention**: Catches timezone-dependent code that could break during DST changes
3. **Auto-fixing**: Many violations can be automatically fixed with `--fix`
4. **Documentation**: Encourages use of well-documented UTC utility functions
5. **Maintainability**: Makes timezone handling explicit and predictable
6. **Accuracy**: Focuses on truly problematic operations, not false positives

## Testing and Examples

### Rule Tests
Comprehensive unit tests for the ESLint rules are located in:
- `tests/unit/eslint-rules/timezone-safety.test.js`

### Example Code
Educational examples showing both problematic and correct patterns:
- `tests/fixtures/timezone-examples.js`

Run `npx eslint tests/fixtures/timezone-examples.js` to see the rules in action.

### Running Tests
```bash
# Test the ESLint rules themselves
npm test tests/unit/eslint-rules/timezone-safety.test.js

# See rule violations on example code
npx eslint tests/fixtures/timezone-examples.js
```

## Integration with CI/CD

These rules run as part of the standard linting process in GitHub Actions, ensuring timezone safety is enforced across all pull requests and deployments.