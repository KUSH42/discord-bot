# Testing Guidelines for Discord YouTube Bot

## Critical Test Execution Rules

**NEVER run full test suites** - use specific patterns to avoid timeouts and excessive output.

When running jest tests, keep the following in mind:
**ALWAYS** run jest using the `npx jest` command.
**NEVER** run jest via `npm run`.

### Jest CLI Parameter Update
Node option `"testPathPattern"` was replaced by COMMAND LINE ARGUMENT `"--testPathPatterns"`. 
`"--testPathPatterns"` is only available as a command-line option.

**Correct usage example:**
`npm run test:unit --testPathPatterns='message-sender' -- --verbose`

**Incorrect usage example - DO NOT USE:**
`npm run test:unit -- --testPathPattern="message-sender" --verbose`

## Correct Test Commands

### Running Individual Test Suites
```bash
# ✅ CORRECT: Run specific test patterns
npm run test:unit --testPathPatterns='message-sender' -- --verbose
npm run test:integration --testPathPatterns='webhook' -- --verbose
npm run test:e2e --testPathPatterns='command-processor' -- --verbose

# ❌ INCORRECT: Old parameter name (deprecated)
npm run test:unit -- --testPathPattern='message-sender' --verbose
```

### Commonly Used Test Patterns
```bash
# Core functionality tests
npm run test:unit --testPathPatterns="command-processor|content-announcer|scraper-application"

# Infrastructure tests  
npm run test:unit --testPathPatterns="dependency-container|state-manager|debug-flag"

# Service tests
npm run test:integration --testPathPatterns="youtube-service|browser-profile"

# Specific component focus
npm run test:unit --testPathPatterns="enhanced-logger" -- --verbose
```

### Development Workflow
```bash
# Watch mode for active development
npm run test:watch --testPathPatterns="your-component"

# Run tests for changed files only
npm test -- --onlyChanged

# Update snapshots when needed
npm test -- --updateSnapshot --testPathPatterns="component-name"
```

## Key Jest Options for This Project

### Essential Flags
- `--testPathPatterns=<regex>` - Target specific test files (replaces deprecated testPathPattern)
- `--verbose` - Detailed test output with individual test names
- `--onlyChanged` - Run tests related to changed files
- `--watch` - Interactive watch mode for development
- `--bail` - Stop on first failure (useful for debugging)

### Performance & Debugging
- `--runInBand` - Run tests serially (helps with async issues)
- `--detectOpenHandles` - Find async operations preventing Jest exit
- `--forceExit` - Force Jest to exit (use sparingly)
- `--maxWorkers=1` - Limit parallelism for debugging

### Coverage & Reporting
- `--coverage` - Generate coverage reports
- `--collectCoverageFrom="src/**/*.js"` - Specify coverage scope
- `--silent` - Suppress console.log output in tests

## Project-Specific Testing Notes

### Test Categories
- **Unit Tests**: Individual component testing with mocks
- **Integration Tests**: Service interaction testing
- **E2E Tests**: Full workflow testing with real Discord/API interactions
- **Performance Tests**: Load testing and benchmarking

### Common Patterns
```bash
# Test specific Discord command handling
npm run test:unit --testPathPatterns="command-processor" -- --testNamePattern="debug commands"

# Test browser automation components
npm run test:integration --testPathPatterns="browser|scraper" -- --verbose

# Test logging and monitoring systems
npm run test:unit --testPathPatterns="enhanced-logger|metrics-manager|debug-flag"
```

### Memory Leak Prevention
Always ensure tests don't call `main()` functions - these start infinite processes and will cause test hangs.

### Useful Jest CLI Reference
- `jest <regexForTestFiles>` - Run tests matching pattern
- `--bail[=<n>]` - Exit after n failures (default: 1)
- `--testNamePattern=<regex>` - Run tests matching specific names
- `--updateSnapshot` - Update test snapshots
- `--detectOpenHandles` - Debug async handle leaks
- `--runInBand` - Disable parallel execution
- `--maxWorkers=<num>` - Control test parallelism