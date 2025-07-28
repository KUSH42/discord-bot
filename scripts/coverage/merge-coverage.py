#!/usr/bin/env python3
"""
Coverage merger that properly merges LCOV files by file instead of concatenating.
This prevents double-counting when the same source files appear in multiple test suites.
"""

import os
import sys
import argparse
from collections import defaultdict

def parse_lcov_file(file_path):
    """Parse an LCOV file and return coverage data by source file."""
    coverage_data = {}
    current_file = None
    
    try:
        with open(file_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('SF:'):
                    # Source file
                    current_file = line[3:]
                    if current_file not in coverage_data:
                        coverage_data[current_file] = {
                            'functions': {},
                            'lines': {},
                            'branches': {},
                            'function_data': [],
                            'branch_data': []
                        }
                elif line.startswith('FN:') and current_file:
                    # Function definition
                    coverage_data[current_file]['function_data'].append(line)
                elif line.startswith('FNDA:') and current_file:
                    # Function execution count
                    parts = line.split(',', 1)
                    if len(parts) == 2:
                        count = int(parts[0][5:])  # Remove FNDA:
                        func_name = parts[1]
                        coverage_data[current_file]['functions'][func_name] = max(
                            coverage_data[current_file]['functions'].get(func_name, 0), count
                        )
                elif line.startswith('DA:') and current_file:
                    # Line execution count
                    parts = line.split(',')
                    if len(parts) == 2:
                        line_num = int(parts[0][3:])  # Remove DA:
                        count = int(parts[1])
                        coverage_data[current_file]['lines'][line_num] = max(
                            coverage_data[current_file]['lines'].get(line_num, 0), count
                        )
                elif line.startswith('BRDA:') and current_file:
                    # Branch data
                    coverage_data[current_file]['branch_data'].append(line)
                    parts = line.split(',')
                    if len(parts) == 4:
                        key = f"{parts[0][5:]}:{parts[1]}:{parts[2]}"  # line:block:branch
                        count = 0 if parts[3] == '-' else int(parts[3])
                        coverage_data[current_file]['branches'][key] = max(
                            coverage_data[current_file]['branches'].get(key, 0), count
                        )
    except Exception as e:
        print(f"Error parsing {file_path}: {e}")
        return {}
    
    return coverage_data

def merge_coverage_files(file_paths):
    """Merge multiple LCOV files by taking the maximum coverage for each file."""
    merged_data = {}
    
    for file_path in file_paths:
        if not os.path.exists(file_path):
            print(f"Warning: File not found: {file_path}")
            continue
            
        print(f"Processing: {file_path}")
        file_data = parse_lcov_file(file_path)
        
        for source_file, data in file_data.items():
            if source_file not in merged_data:
                merged_data[source_file] = {
                    'functions': {},
                    'lines': {},
                    'branches': {},
                    'function_data': data['function_data'][:],  # Copy function definitions
                    'branch_data': data['branch_data'][:]       # Copy branch definitions
                }
            
            # Merge functions (take maximum coverage)
            for func_name, count in data['functions'].items():
                merged_data[source_file]['functions'][func_name] = max(
                    merged_data[source_file]['functions'].get(func_name, 0), count
                )
            
            # Merge lines (take maximum coverage)
            for line_num, count in data['lines'].items():
                merged_data[source_file]['lines'][line_num] = max(
                    merged_data[source_file]['lines'].get(line_num, 0), count
                )
                
            # Merge branches (take maximum coverage)
            for branch_key, count in data['branches'].items():
                merged_data[source_file]['branches'][branch_key] = max(
                    merged_data[source_file]['branches'].get(branch_key, 0), count
                )
    
    return merged_data

def write_merged_lcov(merged_data, output_path):
    """Write merged coverage data to LCOV format."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with open(output_path, 'w') as f:
        for source_file, data in merged_data.items():
            f.write("TN:\n")
            f.write(f"SF:{source_file}\n")
            
            # Write function definitions (deduplicated)
            seen_functions = set()
            for func_line in data['function_data']:
                if func_line not in seen_functions:
                    f.write(f"{func_line}\n")
                    seen_functions.add(func_line)
            
            # Write function coverage
            for func_name, count in data['functions'].items():
                f.write(f"FNDA:{count},{func_name}\n")
            
            # Function summary
            total_funcs = len(data['functions'])
            covered_funcs = sum(1 for count in data['functions'].values() if count > 0)
            f.write(f"FNF:{total_funcs}\n")
            f.write(f"FNH:{covered_funcs}\n")
            
            # Write branch definitions (deduplicated)
            seen_branches = set()
            for branch_line in data['branch_data']:
                if branch_line not in seen_branches:
                    f.write(f"{branch_line}\n")
                    seen_branches.add(branch_line)
            
            # Branch summary
            total_branches = len(data['branches'])
            covered_branches = sum(1 for count in data['branches'].values() if count > 0)
            f.write(f"BRF:{total_branches}\n")
            f.write(f"BRH:{covered_branches}\n")
            
            # Write line coverage
            for line_num, count in sorted(data['lines'].items()):
                f.write(f"DA:{line_num},{count}\n")
            
            # Line summary
            total_lines = len(data['lines'])
            covered_lines = sum(1 for count in data['lines'].values() if count > 0)
            f.write(f"LF:{total_lines}\n")
            f.write(f"LH:{covered_lines}\n")
            
            f.write("end_of_record\n")

def main():
    parser = argparse.ArgumentParser(description='Merge LCOV coverage files properly by file')
    parser.add_argument('files', nargs='+', help='LCOV files to merge')
    parser.add_argument('-o', '--output', required=True, help='Output merged LCOV file')
    
    args = parser.parse_args()
    
    print(f"Merging {len(args.files)} coverage files...")
    merged_data = merge_coverage_files(args.files)
    
    if not merged_data:
        print("No coverage data found!")
        sys.exit(1)
    
    write_merged_lcov(merged_data, args.output)
    
    # Print summary
    total_files = len(merged_data)
    total_lines = sum(len(data['lines']) for data in merged_data.values())
    covered_lines = sum(sum(1 for count in data['lines'].values() if count > 0) for data in merged_data.values())
    total_functions = sum(len(data['functions']) for data in merged_data.values())
    covered_functions = sum(sum(1 for count in data['functions'].values() if count > 0) for data in merged_data.values())
    total_branches = sum(len(data['branches']) for data in merged_data.values())
    covered_branches = sum(sum(1 for count in data['branches'].values() if count > 0) for data in merged_data.values())
    
    coverage_pct = (covered_lines / total_lines * 100) if total_lines > 0 else 0
    function_pct = (covered_functions / total_functions * 100) if total_functions > 0 else 0
    branch_pct = (covered_branches / total_branches * 100) if total_branches > 0 else 0
    
    print(f"\nMerged coverage summary:")
    print(f"  Files: {total_files}")
    print(f"  Lines: {covered_lines}/{total_lines} ({coverage_pct:.2f}%)")
    print(f"  Functions: {covered_functions}/{total_functions} ({function_pct:.2f}%)")
    print(f"  Branches: {covered_branches}/{total_branches} ({branch_pct:.2f}%)")
    print(f"  Output: {args.output}")

if __name__ == '__main__':
    main()