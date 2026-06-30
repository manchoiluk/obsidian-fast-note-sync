import fs from 'fs';
import path from 'path';

// Directories to ignore / 需要忽略的目录
const IGNORED_DIRS = new Set(['.git', 'node_modules']);

/**
 * Recursively count files in the directory.
 * 递归统计目录中的文件数量。
 *
 * @param {string} dirPath - The target directory path. / 目标目录路径。
 * @returns {{ mdCount: number, otherCount: number }} - The counts of markdown and other files. / Markdown 文件和其他文件的统计数量。
 */
function countFiles(dirPath) {
    let mdCount = 0;
    let otherCount = 0;

    try {
        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
            // If the input path is a file, count it directly and return
            // 如果输入路径是一个文件，直接进行统计并返回
            if (path.extname(dirPath).toLowerCase() === '.md') {
                return { mdCount: 1, otherCount: 0 };
            } else {
                return { mdCount: 0, otherCount: 1 };
            }
        }

        const files = fs.readdirSync(dirPath);

        for (const file of files) {
            // Skip ignored directories / 跳过忽略的目录
            if (IGNORED_DIRS.has(file)) {
                continue;
            }

            const fullPath = path.join(dirPath, file);
            try {
                const fileStats = fs.statSync(fullPath);

                if (fileStats.isDirectory()) {
                    // Recursively scan subdirectories / 递归扫描子目录
                    const subCounts = countFiles(fullPath);
                    mdCount += subCounts.mdCount;
                    otherCount += subCounts.otherCount;
                } else if (fileStats.isFile()) {
                    // Count file by extension / 根据后缀统计文件
                    if (path.extname(file).toLowerCase() === '.md') {
                        mdCount++;
                    } else {
                        otherCount++;
                    }
                }
            } catch (err) {
                // Ignore single file/directory errors, print warning / 忽略单个文件或目录错误，打印警告
                console.warn(`Warning: Could not access ${fullPath}: ${err.message}`);
            }
        }
    } catch (err) {
        console.error(`Error: Could not read directory ${dirPath}: ${err.message}`);
    }

    return { mdCount, otherCount };
}

// Main execution block / 主执行块
function main() {
    // Get target path from CLI arguments, fallback to current working directory
    // 从命令行参数获取目标路径，默认回退到当前工作目录
    const targetDir = process.argv[2] || process.cwd();
    const resolvedPath = path.resolve(targetDir);

    console.log(`Starting scan for directory: ${resolvedPath}...`);
    console.log('-------------------------------------------');

    const result = countFiles(resolvedPath);

    console.log('-------------------------------------------');
    console.log(`Scan completed for: ${resolvedPath}`);
    console.log(`Markdown files (.md): ${result.mdCount}`);
    console.log(`Other files:          ${result.otherCount}`);
    console.log(`Total files:          ${result.mdCount + result.otherCount}`);
}

main();
