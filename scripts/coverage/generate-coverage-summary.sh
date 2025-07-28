#!/bin/bash

# Coverage Summary Generator
# Generates local coverage summary when CI artifacts are not available

set -e

# Set locale to avoid decimal separator issues
export LC_ALL=C

echo "🔍 Generating local coverage summary..."

# Function to extract coverage from lcov.info
extract_coverage_from_lcov() {
    local lcov_file=$1
    
    if [ ! -f "$lcov_file" ]; then
        echo "❌ LCOV file not found: $lcov_file"
        return 1
    fi
    
    local lines_found=$(grep -E "^LF:" "$lcov_file" | awk -F: '{sum+=$2} END {print sum}')
    local lines_hit=$(grep -E "^LH:" "$lcov_file" | awk -F: '{sum+=$2} END {print sum}')
    local functions_found=$(grep -E "^FNF:" "$lcov_file" | awk -F: '{sum+=$2} END {print sum}')
    local functions_hit=$(grep -E "^FNH:" "$lcov_file" | awk -F: '{sum+=$2} END {print sum}')
    local branches_found=$(grep -E "^BRF:" "$lcov_file" | awk -F: '{sum+=$2} END {print sum}')
    local branches_hit=$(grep -E "^BRH:" "$lcov_file" | awk -F: '{sum+=$2} END {print sum}')
    
    # Default to 0 if empty
    lines_found=${lines_found:-0}
    lines_hit=${lines_hit:-0}
    functions_found=${functions_found:-0}
    functions_hit=${functions_hit:-0}
    branches_found=${branches_found:-0}
    branches_hit=${branches_hit:-0}
    
    local coverage_pct=0
    local functions_pct=0
    local branches_pct=0
    
    if [ "$lines_found" -gt 0 ]; then
        coverage_pct=$(echo "scale=2; $lines_hit * 100 / $lines_found" | bc -l)
    fi
    
    if [ "$functions_found" -gt 0 ]; then
        functions_pct=$(echo "scale=2; $functions_hit * 100 / $functions_found" | bc -l)
    fi
    
    if [ "$branches_found" -gt 0 ]; then
        branches_pct=$(echo "scale=2; $branches_hit * 100 / $branches_found" | bc -l)
    fi
    
    echo "📊 Coverage from $lcov_file:"
    echo "  Lines: $lines_hit/$lines_found (${coverage_pct}%)"
    echo "  Functions: $functions_hit/$functions_found (${functions_pct}%)"
    echo "  Branches: $branches_hit/$branches_found (${branches_pct}%)"
    
    # Create coverage-summary.json
    cat > coverage-summary.json << EOF
{
  "total": {
    "lines": {
      "total": $lines_found,
      "covered": $lines_hit,
      "skipped": 0,
      "pct": $coverage_pct
    },
    "statements": {
      "total": $lines_found,
      "covered": $lines_hit,
      "skipped": 0,
      "pct": $coverage_pct
    },
    "functions": {
      "total": $functions_found,
      "covered": $functions_hit,
      "skipped": 0,
      "pct": $functions_pct
    },
    "branches": {
      "total": $branches_found,
      "covered": $branches_hit,
      "skipped": 0,
      "pct": $branches_pct
    }
  }
}
EOF
    
    echo "✅ Generated coverage-summary.json with ${coverage_pct}% line coverage"
    return 0
}

# Generate coverage summary if it doesn't exist or is empty
if [ ! -f "coverage-summary.json" ] || [ ! -s "coverage-summary.json" ] || grep -q '"pct": 0' coverage-summary.json; then
    echo "📋 coverage-summary.json missing or empty, generating from lcov.info files..."
    
    # Look for the main coverage file first
    if [ -f "coverage/lcov.info" ]; then
        extract_coverage_from_lcov "coverage/lcov.info"
    elif [ -f "test-results/unit-node20/coverage/unit/lcov.info" ]; then
        extract_coverage_from_lcov "test-results/unit-node20/coverage/unit/lcov.info"
    elif [ -f "test-results/integration/coverage/integration/lcov.info" ]; then
        extract_coverage_from_lcov "test-results/integration/coverage/integration/lcov.info"
    else
        echo "❌ No coverage files found. Available lcov.info files:"
        find . -name "lcov.info" -type f 2>/dev/null | head -5 || echo "  None found"
        
        # Create fallback coverage-summary.json
        cat > coverage-summary.json << EOF
{
  "total": {
    "lines": {"total": 0, "covered": 0, "skipped": 0, "pct": 0},
    "statements": {"total": 0, "covered": 0, "skipped": 0, "pct": 0},
    "functions": {"total": 0, "covered": 0, "skipped": 0, "pct": 0},
    "branches": {"total": 0, "covered": 0, "skipped": 0, "pct": 0}
  }
}
EOF
        echo "⚠️ Created fallback coverage-summary.json with 0% coverage"
        return 1
    fi
else
    echo "✅ coverage-summary.json already exists and looks valid"
fi

# Extract coverage percentage for display - more robust extraction with fallback
if command -v jq >/dev/null 2>&1; then
    OVERALL_COVERAGE=$(jq -r '.total.lines.pct // 0' coverage-summary.json 2>/dev/null | awk '{if($1 == "") print "0"; else printf "%.2f", $1}')
else
    # Fallback using grep and awk when jq is not available
    OVERALL_COVERAGE=$(grep '"pct"' coverage-summary.json | head -1 | awk -F: '{gsub(/[, ]/, "", $2); printf "%.2f", $2}' 2>/dev/null || echo "0")
fi

if [ -n "$OVERALL_COVERAGE" ] && [ "$OVERALL_COVERAGE" != "0.00" ]; then
    echo ""
    echo "🎯 Current overall coverage: ${OVERALL_COVERAGE}%"
    
    # Coverage quality assessment using arithmetic comparison
    COVERAGE_INT=$(awk -v val="$OVERALL_COVERAGE" 'BEGIN {printf "%.0f", val * 100}')
    if [ "$COVERAGE_INT" -ge 2500 ]; then
        echo "✅ Coverage meets minimum standards (≥25%)"
    elif [ "$COVERAGE_INT" -ge 1500 ]; then
        echo "⚠️ Coverage below target but acceptable (≥15%)"
    else
        echo "❌ Coverage below minimum standards (<15%)"
    fi
else
    echo "⚠️ Could not extract coverage percentage or coverage is 0%"
fi

echo ""
echo "📄 coverage-summary.json is ready for use by CI scripts"