# 🧪 Testing Quick Start Guide

## ⚡ Fast Development Commands

```bash
# Start here - Development optimized testing
npm run test:dev           # Fast feedback, single worker, bail on first failure

# Watch mode for continuous development
npm run test:watch         # Auto-run tests on file changes

# Only test what you've changed
npm run test:changed       # Git-aware testing

# Full test suite when you're ready
npm test                   # All tests with coverage
```

## 🎯 Testing Specific Components

```bash
# Target specific test types
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:e2e           # End-to-end tests

# Test specific files/patterns
npm run test:file -- command-processor
npm run test:file -- fallback
```

## 🚀 Performance & Debugging

```bash
# Faster execution
npm run test:parallel      # 50% worker utilization

# Debug failing tests
npm run test:debug         # Debug mode with breakpoints
npm run test:verbose       # Detailed output

# Interactive test runner
npm run test:runner unit   # Enhanced CLI with colors
npm run test:runner coverage --verbose
```

## 📊 Coverage & Quality

```bash
# Generate coverage report
npm run test:coverage      # Creates coverage/ directory

# Check coverage thresholds
# Global: 25% statements/lines, 20% branches, 25% functions
# Core modules: 50% statements/lines, 40% branches, 55% functions
# Critical components: 85-90% coverage
```

## 🔧 Configuration Files

- **`jest.config.js`** - Production config with full coverage enforcement
- **`jest.dev.config.js`** - Development config for fast feedback
- **`jest.e2e.config.js`** - End-to-end test configuration
- **`jest.security.config.js`** - Security test configuration

## 🛠️ Common Development Workflow

```bash
# 1. Start development with fast feedback
npm run test:dev -- --watch

# 2. Run specific test types as you work
npm run test:unit -- your-component

# 3. Before committing, run all tests
npm test

# 4. Debug if needed
npm run test:debug -- failing-test
```

## 🏗️ Test Structure

```
tests/
├── unit/           # Individual component tests
├── integration/    # Component interaction tests
├── e2e/           # End-to-end workflow tests
├── performance/   # Performance benchmarks
├── security/      # Security validation tests
├── fixtures/      # Test data and helpers
└── mocks/         # Mock implementations
```

## ✅ Coverage Requirements

| Component Type          | Statements | Branches | Functions | Lines  |
| ----------------------- | ---------- | -------- | --------- | ------ |
| **Global**              | 50%        | 40%      | 50%       | 40%    |
| **Core Modules**        | 70%        | 60%      | 65%       | 60%    |
| **Critical Components** | 85-90%     | 75-85%   | 90%       | 85-90% |

## 🎨 Interactive Test Runner

```bash
# Launch the enhanced test runner
npm run test:runner --help

# Examples
npm run test:runner unit              # Run unit tests
npm run test:runner coverage          # Generate coverage
npm run test:runner watch --bail      # Watch mode with fail-fast
npm run test:runner dev               # Development mode
```

## 📋 Quick Commands Reference

| Command                 | Purpose                   |
| ----------------------- | ------------------------- |
| `npm run test:dev`      | Fast development testing  |
| `npm run test:watch`    | Auto-run on file changes  |
| `npm run test:changed`  | Git-aware testing         |
| `npm run test:parallel` | Faster parallel execution |
| `npm run test:debug`    | Debug with breakpoints    |
| `npm run test:runner`   | Interactive test runner   |
| `npm run test:coverage` | Generate coverage report  |

## 🐛 Common Testing Patterns & Gotchas

### Enhanced Logger Testing

Components using `createEnhancedLogger` create child logger instances, not the mock logger directly:

```javascript
// ❌ This won't work - tests the mock base logger
expect(mockLogger.error).toHaveBeenCalledWith(...);

// ✅ This works - spy on the enhanced logger instance
const enhancedLogger = component.logger;
const errorSpy = jest.spyOn(enhancedLogger, 'error');
expect(errorSpy).toHaveBeenCalledWith(...);
```

**Why**: Enhanced logger creates isolated child loggers with correlation tracking and performance metrics, so the actual logging calls don't reach the base mock.

---

💡 **Pro Tip**: Start with `npm run test:dev -- --watch` for the fastest
development experience!

📚 **Full Documentation**: See `tests/README.md` and `CLAUDE.md` for
comprehensive testing guidelines.
