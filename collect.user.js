// ==UserScript==
// @name         超星自测作业题目采集器
// @namespace    https://github.com/Jason7187/chaoxing-script
// @version      1.0.2
// @description  支持一键解析课程题目，智能识别单选/多选/填空/判断等题型，可导出为CSV/Excel格式。提供可视化预览  -- 对新版自测及作业适配
// @author       Jason7187
// @match        *://mooc1.chaoxing.com/mooc-ans/mooc2/work/*
// @match        *://mooc1.chaoxing.com/exam-ans/exam/*
// @icon         https://maxpcimg.online/i/2025/04/11/67f8656abe8db.png
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @updateURL    https://raw.githubusercontent.com/Jason7187/chaoxing-script/main/collect.user.js
// @downloadURL  https://raw.githubusercontent.com/Jason7187/chaoxing-script/main/collect.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.17.4/xlsx.full.min.js

// ==/UserScript==

(function() {
    'use strict';

    // ================= 全局配置 =================
    const CONFIG = {
        DELAY_INIT: 2000,
        ANSWER_SPLITTER: '###',
        OPTION_SPLITTER: ' | ',
        PREVIEW_LIMIT: 100,
        HOTKEYS: {
            SHOW: 'ArrowRight',
            HIDE: 'ArrowLeft'
        }
    };

    let currentData = [];
    let isToolbarVisible = true;

    // ================= 核心解析模块 =================
    class CXParser {
        static parseAll() {
            const { courseName, courseId } = this.getCourseInfo();
            return Array.from(document.querySelectorAll('.questionLi')).map(container => {
                const type = this.parseType(container);
                return {
                    courseName,
                    courseId,
                    type,
                    question: this.parseQuestion(container),
                    options: this.parseOptions(container),
                    answer: this.parseAnswer(container, type)
                };
            }).filter(item => item.answer);
        }

        static getCourseInfo() {
            return {
                courseName: document.querySelector('h2.mark_title')?.textContent.trim() || '未知课程',
                courseId: new URLSearchParams(location.search).get('courseId') || '未知ID'
            };
        }

        static parseType(container) {
            return (container.querySelector('.colorShallow')?.textContent.trim() || '')
                .replace(/[()（）]/g, '');
        }

        static parseQuestion(container) {
            return (container.querySelector('.qtContent')?.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        static parseOptions(container) {
            return Array.from(container.querySelectorAll('.mark_letter li'))
                .map(li => li.textContent.trim())
                .join(CONFIG.OPTION_SPLITTER);
        }

        static parseAnswer(container, type) {
            try {
                const answerElement = container.querySelector('.rightAnswerContent, .colorGreen');
                let rawAnswer = answerElement?.textContent || '';
                
                // 统一清理答案前缀
                rawAnswer = rawAnswer.replace(/^[\s\S]*?[：:]\s*/, '').trim();

                if (['单选题', '多选题'].includes(type)) {
                    const optionsMap = this.buildOptionsMap(container);
                    return rawAnswer.split('')
                        .map(c => this.extractOptionText(optionsMap[c]))
                        .filter(Boolean)
                        .join(type === '多选题' ? CONFIG.ANSWER_SPLITTER : '');
                }

                if (type === '填空题') {
                    return rawAnswer.split(/(?:$|（)\d+(?:$|）)/g)
                        .map(s => s.trim().replace(/^[：:]\s*/, ''))
                        .filter(Boolean)
                        .join(CONFIG.ANSWER_SPLITTER);
                }

                return this.formatJudgmentAnswer(rawAnswer);
            } catch (e) {
                console.error('解析失败:', e);
                return '';
            }
        }

        static buildOptionsMap(container) {
            return Array.from(container.querySelectorAll('.mark_letter li')).reduce((map, li, index) => {
                const key = String.fromCharCode(65 + index);
                map[key] = li.textContent.trim();
                return map;
            }, {});
        }

        static extractOptionText(fullOption) {
            return fullOption?.replace(/^([A-Z])[．.。]?\s*/, '') || '';
        }

        static formatJudgmentAnswer(text) {
            return text.replace(/√/, '正确').replace(/×/, '错误');
        }
    }

    // ================= 数据导出模块 =================
    class DataExporter {
        static exportCSV(data) {
            const escapeCSV = (text) => {
                if (/[\n\t"]/.test(text)) {
                    return `"${text.replace(/"/g, '""')}"`;
                }
                return text;
            };

            const content = data.map(item => [
                item.courseName,
                item.courseId,
                item.type,
                item.question,
                item.options,
                item.answer
            ].map(escapeCSV).join('\t')).join('\n');

            this.downloadFile("\uFEFF" + content, 
                `${this.getFileName()}.csv`, 
                'text/csv;charset=utf-8;'
            );
        }

        static exportExcel(data) {
            const worksheet = XLSX.utils.json_to_sheet(data.map(item => ({
                '课程名称': item.courseName,
                '课程ID': item.courseId,
                '题型': item.type,
                '题目内容': item.question,
                '选项': item.options,
                '正确答案': item.answer
            })));

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '题目数据');
            XLSX.writeFile(workbook, `${this.getFileName()}.xlsx`);
        }

        static downloadFile(content, fileName, type) {
            const blob = new Blob([content], { type });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.click();
        }

        static getFileName() {
            const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            return `超星题目_${CXParser.getCourseInfo().courseName}_${date}`;
        }
    }

    // ================= 预览界面模块 =================
    class PreviewUI {
        static show(data) {
            this.close();
            const preview = this.createPreview(data);
            this.injectStyles();
            document.body.appendChild(preview);
        }

        static createPreview(data) {
            const preview = document.createElement('div');
            preview.id = 'cx-preview';
            preview.innerHTML = `
                <div class="header">
                    <h3>已解析 ${data.length} 道题目</h3>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="table-container">
                    ${this.createTable(data)}
                </div>
                <div class="action-bar">
                    <button class="export-btn csv">导出CSV</button>
                    <button class="export-btn excel">导出Excel</button>
                </div>
            `;

            preview.querySelector('.close-btn').onclick = () => this.close();
            preview.querySelector('.csv').onclick = () => DataExporter.exportCSV(currentData);
            preview.querySelector('.excel').onclick = () => DataExporter.exportExcel(currentData);
            
            return preview;
        }

        static createTable(data) {
            return `
                <table>
                    <thead>
                        <tr>
                            <th>课程名称</th>
                            <th>课程ID</th>
                            <th>题型</th>
                            <th>题目内容</th>
                            <th>选项</th>
                            <th class="answer-col">正确答案</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.slice(0, CONFIG.PREVIEW_LIMIT).map(item => `
                            <tr>
                                <td>${item.courseName}</td>
                                <td>${item.courseId}</td>
                                <td>${item.type}</td>
                                <td>${item.question}</td>
                                <td>${item.options.replace(/\|/g, '<br>')}</td>
                                <td class="answer">${item.answer}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        static injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                #cx-preview {
                    position: fixed;
                    top: 80px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 95%;
                    max-width: 1400px;
                    height: 80vh;
                    background: white;
                    box-shadow: 0 0 30px rgba(0,0,0,0.2);
                    border-radius: 12px;
                    z-index: 99999;
                    display: flex;
                    flex-direction: column;
                }

                .header {
                    padding: 18px;
                    border-bottom: 1px solid #eee;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .close-btn {
                    background: none;
                    border: none;
                    font-size: 24px;
                    color: #666;
                    cursor: pointer;
                    padding: 0 12px;
                }

                .table-container {
                    flex: 1;
                    overflow: auto;
                    padding: 0 18px;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 12px 0;
                    table-layout: auto;
                }

                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #eee;
                    vertical-align: top;
                }

                th {
                    background: #f8f9fa;
                    position: sticky;
                    top: 0;
                    white-space: nowrap;
                }

                td {
                    min-width: 120px;
                }

                .answer {
                    color: #28a745;
                    font-weight: 500;
                    white-space: normal;
                }

                .action-bar {
                    padding: 18px;
                    border-top: 1px solid #eee;
                    display: flex;
                    gap: 12px;
                }

                .export-btn {
                    flex: 1;
                    padding: 12px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: opacity 0.2s;
                }

                .csv { background: #4CAF50; color: white; }
                .excel { background: #2196F3; color: white; }

                @media (max-width: 768px) {
                    #cx-preview {
                        width: 100%;
                        height: 100vh;
                        top: 0;
                        left: 0;
                        transform: none;
                        border-radius: 0;
                    }

                    th, td {
                        padding: 8px;
                        font-size: 13px;
                    }

                    .answer-col {
                        display: none;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        static close() {
            const preview = document.getElementById('cx-preview');
            preview?.remove();
        }
    }

    // ================= 主控制模块 =================
    class MainController {
        static init() {
            this.initToolbar();
            this.initHotkeys();
        }

        static initToolbar() {
            const toolbar = document.createElement('div');
            toolbar.id = 'cx-toolbar';
            toolbar.innerHTML = `
                <button class="parse-btn">
                    <span style="margin-right: 8px;">✨</span>开始解析
                </button>
            `;

            toolbar.querySelector('.parse-btn').onclick = () => {
                currentData = CXParser.parseAll();
                currentData.length ? PreviewUI.show(currentData) : this.showError();
            };

            document.body.appendChild(toolbar);
            this.injectToolbarStyles();
        }

        static injectToolbarStyles() {
            const style = document.createElement('style');
            style.textContent = `
                #cx-toolbar {
                    position: fixed;
                    top: 40px;
                    right: 10px;
                    background: white;
                    padding: 6px;
                    border-radius: 8px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
                    z-index: 10000;
                    transition: transform 0.3s ease;
                }

                #cx-toolbar.hidden {
                    transform: translateX(calc(100% + 30px));
                }

                .parse-btn {
                    padding: 10px 20px;
                    background: #2196F3;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    transition: transform 0.2s;
                }

                .parse-btn:hover {
                    transform: translateY(-2px);
                }

                @media (max-width: 480px) {
                    #cx-toolbar {
                        top: 10px;
                        right: 10px;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        static initHotkeys() {
            document.addEventListener('keydown', e => {
                if (document.activeElement.tagName === 'INPUT') return;

                switch(e.key) {
                    case CONFIG.HOTKEYS.HIDE:
                        this.hideToolbar();
                        break;
                    case CONFIG.HOTKEYS.SHOW:
                        this.showToolbar();
                        break;
                }
            });
        }

        static hideToolbar() {
            const toolbar = document.getElementById('cx-toolbar');
            toolbar?.classList.add('hidden');
            isToolbarVisible = false;
        }

        static showToolbar() {
            const toolbar = document.getElementById('cx-toolbar');
            toolbar?.classList.remove('hidden');
            isToolbarVisible = true;
        }

        static showError() {
            GM_notification({
                title: '解析失败',
                text: '未检测到有效题目，请确认当前页面是否正确',
                image: 'https://img.icons8.com/color/48/000000/error--v1.png',
                timeout: 3000
            });
        }
    }

    // ================= 初始化入口 =================
    setTimeout(() => {
        try {
            MainController.init();
        } catch (e) {
            console.error('初始化失败:', e);
            GM_notification({
                title: '脚本加载失败',
                text: '请刷新页面重试',
                image: 'https://img.icons8.com/color/48/000000/error--v1.png',
                timeout: 5000
            });
        }
    }, CONFIG.DELAY_INIT);

})();
