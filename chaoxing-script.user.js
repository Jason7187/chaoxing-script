// ==UserScript== 
// @name         超星学习通自测题目解析导出工具
// @namespace    http://tampermonkey.net/
// @version      4.8
// @description  【普通制表符分隔|答案纯文本|多选###分隔|支持自测部分的单选、多选、判断、以及名词解释】
// @author       Jason7187
// @match        *://*.chaoxing.com/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.17.4/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/Jason7187/chaoxing-script/main/chaoxing-script.user.js
// @downloadURL  https://raw.githubusercontent.com/Jason7187/chaoxing-script/main/chaoxing-script.user.js

// ==/UserScript==
(function() {
    'use strict';

    // 获取用户输入的课程名称和课程ID
    const getCourseInfo = () => {
        const courseName = prompt('请输入课程名称：');
        const courseId = prompt('请输入课程ID：');
        return { courseName, courseId };
    };

    // 主解析函数
    const parseQuestions = () => {
        const results = [];
        
        document.querySelectorAll('.questionLi').forEach(container => {
            const typeElement = container.querySelector('.mark_name .colorShallow');
            if (!typeElement) return;

            const rawType = typeElement.textContent.match(/\((.*?)\)/)?.[1] || '';
            const question = container.querySelector('.qtContent')?.textContent.trim() || '';

            if (['单选题', '多选题', '选择题'].includes(rawType)) {
                results.push(handleChoice(container, rawType, question));
            } else if (rawType === '名词解释') {
                results.push(handleExplanation(container));
            } else if (rawType === '判断题') {  // 新增判断题解析
                results.push(handleJudgment(container, question));
            }
        });

        return results.filter(item => item.question);
    };

    // 处理选择题，支持不限于ABCD等多个选项
    const handleChoice = (container, type, question) => {
        const options = Array.from(container.querySelectorAll('.mark_letter li'))
            .map(li => {
                const text = li.textContent.trim();
                return text.replace(/^([A-Z])[．.。]?\s*/, '$1. ');
            });

        const optionMap = options.reduce((map, opt) => {
            const [key, ...parts] = opt.split('. ');
            map[key] = parts.join('. ').trim();
            return map;
        }, {});

        const rawAnswer = container.querySelector('.rightAnswerContent, .colorGreen dd')?.textContent.trim() || '';

        let processedAnswer = '';
        if (rawAnswer) {
            processedAnswer = rawAnswer.split('')
                .filter(c => /^[A-Z]$/.test(c)) // 动态支持字母选项
                .map(c => optionMap[c] || '')
                .filter(Boolean)
                .join(type === '多选题' ? ' ### ' : ' '); // 多选题使用" ### "分隔
        }

        return {
            type: type,
            question: question,
            options: options.join(' | '),
            answer: processedAnswer
        };
    };

    // 处理名词解释
    const handleExplanation = (container) => ({
        type: '名词解释',
        question: container.querySelector('.qtContent').textContent.trim(),
        options: '',
        answer: container.querySelector('.mark_answer_key .colorGreen dd')?.textContent.trim() || ''
    });

    // 处理判断题
    const handleJudgment = (container, question) => {
        const options = Array.from(container.querySelectorAll('.mark_letter li'))
            .map(li => li.textContent.trim());

        let answer = '';

        // 判断选项并输出相应答案，删除字母，直接输出选项内容
        options.forEach(opt => {
            const answerText = opt.replace(/^[A-D][．.。]?\s*/, '').trim(); // 去掉字母和多余的标点
            if (/正确|对|错误|错/.test(answerText)) {
                answer = answerText;  // 输出选项中的答案内容
            }
        });

        return {
            type: '判断题',
            question: question,
            options: options.join(' | '), // 判断题选项
            answer: answer
        };
    };

    // ================= 新版CSV导出功能 =================
    const exportToCSV = (data) => {
        const { courseName, courseId } = getCourseInfo();  // 获取课程信息
        const TAB = '\t';  // 使用普通制表符
        const csvContent = [
            ['课程名称', '课程ID', '题型', '题目内容', '选项', '正确答案'].join(TAB),  // 表头
            ...data.map(item => [
                courseName,
                courseId,
                item.type,
                item.question.replace(/"/g, '""'),
                item.options.replace(/"/g, '""'),
                item.answer.replace(/"/g, '""')
            ].join(TAB))
        ].join('\n');

        const blob = new Blob(["\uFEFF" + csvContent], { 
            type: 'text/csv;charset=utf-8;' 
        });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `chaoxing_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    };

    // ================= Excel导出功能 =================
    const exportToExcel = (data) => {
        const { courseName, courseId } = getCourseInfo();  // 获取课程信息
        const worksheet = XLSX.utils.json_to_sheet(data.map(item => ({
            '课程名称': courseName,
            '课程ID': courseId,
            '题型': item.type,
            '题目内容': item.question,
            '选项': item.options,
            '正确答案': item.answer
        })));
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '题目数据');
        XLSX.writeFile(workbook, `超星题目_${getFormattedDate()}.xlsx`);
    };

    // ================= 预览功能 =================
    const showPreview = (data) => {
        const preview = document.createElement('div');
        preview.style.cssText = ` 
            position: fixed; top: 50px; left: 50%; 
            transform: translateX(-50%); width: 90%; max-width: 1200px; 
            height: 80vh; background: white; z-index: 99999; 
            box-shadow: 0 0 20px rgba(0,0,0,0.3); border-radius: 8px; 
            padding: 20px; overflow: hidden; display: flex; flex-direction: column;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 15px;';
        header.innerHTML = ` 
            <h3 style="margin: 0; color: #333;">题目解析结果（共${data.length}题）</h3>
            <button style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666; padding: 0 10px;">&times;</button>
        `;
        header.querySelector('button').onclick = () => preview.remove();

        const tableContainer = document.createElement('div');
        tableContainer.style.cssText = 'flex: 1; overflow: auto; margin-bottom: 15px;';

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%; border-collapse: collapse;
            font-size: 14px; table-layout: fixed;
        `;
        table.innerHTML = `
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="width: 120px; padding: 12px; text-align: left; border-bottom: 2px solid #eee;">课程名称</th>
                    <th style="width: 100px; padding: 12px; text-align: left; border-bottom: 2px solid #eee;">课程ID</th>
                    <th style="width: 120px; padding: 12px; text-align: left; border-bottom: 2px solid #eee;">题型</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #eee;">题目内容</th>
                    <th style="width: 25%; padding: 12px; text-align: left; border-bottom: 2px solid #eee;">选项</th>
                    <th style="width: 35%; padding: 12px; text-align: left; border-bottom: 2px solid #eee; color: #28a745;">正确答案</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(item => `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 12px; vertical-align: top;">${item.courseName}</td>
                        <td style="padding: 12px; vertical-align: top;">${item.courseId}</td>
                        <td style="padding: 12px; vertical-align: top;">${item.type}</td>
                        <td style="padding: 12px; vertical-align: top;">${item.question}</td>
                        <td style="padding: 12px; vertical-align: top; white-space: pre-wrap;">${item.options.replace(/\|/g, '<br>')}</td>
                        <td style="padding: 12px; vertical-align: top; color: #28a745; font-weight: 500;">${item.answer}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;

        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'display: flex; gap: 10px;';
        actionBar.innerHTML = `
            <button style="flex: 1; padding: 12px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">导出CSV</button>
            <button style="flex: 1; padding: 12px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">导出Excel</button>
        `;

        actionBar.querySelectorAll('button').forEach((btn, index) => {
            btn.onclick = () => index === 0 ? exportToCSV(data) : exportToExcel(data);
        });

        tableContainer.appendChild(table);
        preview.append(header, tableContainer, actionBar);
        document.body.appendChild(preview);
    };

    // ================= 工具函数 =================
    const getFormattedDate = () => {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    };

    // ================= 初始化 =================
    const init = () => {
        if (document.getElementById('cx-parse-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'cx-parse-btn';
        btn.textContent = '解析题目';
        btn.style.cssText = `
            position: fixed; top: 70px; right: 20px; z-index: 99999;
            padding: 12px 24px; background: #FF5722; color: white;
            border: none; border-radius: 4px; cursor: pointer;
            box-shadow: 0 3px 6px rgba(0,0,0,0.16); transition: 0.2s;
        `;
        btn.onmouseenter = () => btn.style.transform = 'translateY(-2px)';
        btn.onmouseleave = () => btn.style.transform = 'none';
        btn.onclick = () => {
            const data = parseQuestions();
            data.length > 0 ? showPreview(data) : alert('未找到有效题目');
        };

        document.body.appendChild(btn);
    };

    setTimeout(init, 2000);
})();
