import axios from 'axios'
import { Constitution } from './constitution'

type MemoryPack = { summary: string; recent: Array<{ user: string; assistant: string }> }

type DebateReplyResult = {
    reply: string
    meta: {
        stance: string
        stanceSummary: string
        keyPoints: string[]
    }
}

type DebateTurnContext = {
    speaker: string
    reply: string
    stance?: string
    stanceSummary?: string
}

type ReverseQuestionResult = {
    question: string
    meta: {
        focus: string
    }
}

type EmotionEchoResult = {
    reply: string
    emotionLabel: string
}

function clampDebateText(text: string, maxLength: number) {
    const trimmed = String(text || '').trim()
    if (trimmed.length <= maxLength) return trimmed
    return `${trimmed.slice(0, maxLength).replace(/[\s。！？；,，、:：]+$/g, '')}…`
}

export default {
    async generateReply({ constitution, memoryPack, input, evidence, requireCitation }:
        { constitution: Constitution; memoryPack: MemoryPack; input: string; evidence: Array<{ id: string; text: string }>; requireCitation?: boolean }) {

        const API_KEY = process.env.DEEPSEEK_API_KEY
        const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1'

        if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured')

        console.log('Using DeepSeek API at', API_URL)

        const parts: string[] = []
        parts.push(`角色说明：${constitution.instructions}`)
        parts.push(`问题：${input}`)
        if (memoryPack.summary) parts.push(`记忆摘要：${memoryPack.summary}`)
        if (memoryPack.recent.length) {
            parts.push('最近对话：')
            memoryPack.recent.forEach((t, i) => parts.push(`${i + 1}. 用户：${t.user}；助理：${t.assistant}`))
        }
        if (evidence && evidence.length) {
            parts.push('参考材料（仅可引用下列项，引用时请使用对应 id）：')
            evidence.forEach(ev => parts.push(`- [${ev.id}] ${ev.text}`))
        } else {
            parts.push('参考材料：无')
        }

        // Embed historical-persona constraints (user-provided template)
        const historyConstraintPrompt = `【历史人物对话约束提示词】
你正在模拟一位真实历史人物进行对话。必须严格遵守以下规则：

1. 时间锚定：该人物的一切知识、认知、语言表达，必须严格限定在其去世年份之前。凡其去世后出现的事件、科技、人物、理论、地名、作品等，均视为“未知”。
2. 认知边界处理：
   · 如果用户提到该人物不可能知道的事物，不得假装知道或强行解释。
   · 正确做法：根据该人物的性格和知识背景，合理表现“困惑”、“误解”、“用已知类比未知”、“拒绝回答”或“认为对方在胡说”等符合其时代与人格的反应。
   · 示例：若用户询问超出现实范围的现代术语，人物可以自然表示不理解或以其时代的比喻回应。
3. 语言风格：尽量模仿该人物的真实写作或演讲风格，但不得因此牺牲认知真实性。
4. 元说明禁止：不得在对话中主动以现代AI视角解释“我作为AI无法知道”或使用相似措辞；应以角色身份自然表现出无知或误解。
5. 冲突解决：若用户纠正或质疑人物的无知，人物可表现出困惑、好奇、拒绝或嘲讽，但不得在对话过程中“学到”未来知识后改变自身立场。

请将以上规则视为严格系统指令；在回答前先比对问题是否在角色知识范围内，若不在范围请直接以角色身份简短拒绝（例如“关于此事我无法确定”或“我不明白你的问题”），不要推测或类比，也不要给出任何真实世界的外部引用或现代术语。`;

        // Add explicit refusal and citation rules
        const refusalInstruction = '在生成回答之前，请参照上面的历史人物约束，先判断问题是否落入本角色认知范围；若超出范围，请简短拒绝，不进行推测或扩展。'
        const citationInstruction = '重要：只能引用上面“参考材料”中列出的条目，不得编造或新增任何参考或来源。引用格式：在回答末尾单独一行添加：\n引用证据IDs: id1,id2 （若未使用任何证据，写：引用证据IDs: 无）。若需要引用但参考材料不足，请直接回复 "关于此事我无法确定"。'
        const noInlineCitation = '不要在回答正文中插入证据 ID、方括号或内联注记；若不要求引用，请只给出自然语言回答，后续接口会单独返回证据列表用于展示。'
        const mustCheckScope = '重要：在任何情况下都不要输出链式思考、内部推理或元认知（如“我思考...”/“让我想想”）。回答应直接、简洁且仅基于本角色的知识与所提供的参考材料。'

        let systemPrompt = historyConstraintPrompt + '\n' + parts.join('\n') + '\n' + refusalInstruction + '\n'
        if (requireCitation) {
            systemPrompt += citationInstruction + '\n'
        } else {
            systemPrompt += noInlineCitation + '\n'
        }
        systemPrompt += mustCheckScope + '\n' + '请以该角色风格、认知限制和史料为依据回答，必要时说明不确定性。'

        try {
            const resp = await axios.post(
                `${API_URL}/chat/completions`,
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: input }
                    ],
                    temperature: 0.2,
                    max_tokens: 800
                },
                { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` } }
            )

            let message = resp.data?.choices?.[0]?.message?.content || resp.data?.output || JSON.stringify(resp.data)

            // Post-process: check for forbidden phrases in constitution to avoid persona drift
            const forbidden: string[] = (constitution as any).forbiddenPhrases || []
            const lower = String(message).toLowerCase()
            const hasForbidden = forbidden.some(fp => lower.includes(fp.toLowerCase()))
            if (hasForbidden) {
                return '关于此事我无法确定。我们不应超出本角色的知识范围。'
            }

            // If citation enforcement is required, verify compliance
            if (requireCitation) {
                // Verify citation compliance: expect a trailing line like "引用证据IDs: ..."
                const match = String(message).match(/引用证据IDs:\s*([^\n\r]*)/m)
                if (!match) {
                    // Non-compliant: no citation line
                    return '关于此事我无法确定。回答未遵守引用规则（缺少引用证据IDs）。'
                }

                const idsPart = match[1].trim()
                if (idsPart !== '无') {
                    const used = idsPart.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
                    const evidenceIds = (evidence || []).map(e => e.id)
                    const unknown = used.filter(u => !evidenceIds.includes(u))
                    if (unknown.length > 0) {
                        // model cited unknown evidence -> refuse
                        return '关于此事我无法确定。回答包含未提供的参考资料，可能为杜撰，故无法接受该回答。'
                    }
                }

                // Additionally check for raw URLs not present in evidence texts
                const urlRegex = /https?:\/\/[\w\-\.\/?#=&%]+/g
                const urls = String(message).match(urlRegex) || []
                const evidenceText = (evidence || []).map(e => e.text).join('\n')
                const badUrl = urls.find(u => !evidenceText.includes(u))
                if (badUrl) {
                    return '关于此事我无法确定。回答包含未提供或未知的外部链接，可能为杜撰。'
                }
            }

            return message
        } catch (err: any) {
            console.error('DeepSeek call failed:', err.response?.data || err.message)
            throw err
        }
    }

    ,
    async generateDebateReply({ constitution, topic, input, memoryPack, debateContext }:
        { constitution: Constitution; topic: string; input: string; memoryPack: MemoryPack; debateContext?: DebateTurnContext[] }): Promise<DebateReplyResult> {
        const API_KEY = process.env.DEEPSEEK_API_KEY
        const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1'
        if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured')

        const recentTurns = memoryPack.recent
            .map((t, i) => `${i + 1}. 上轮输入：${t.user}\n   上轮回应：${t.assistant}`)
            .join('\n')

        const sessionTurns = (debateContext || [])
            .map((turn, i) => {
                const stance = turn.stance ? `｜立场：${turn.stance}` : ''
                const summary = turn.stanceSummary ? `｜摘要：${turn.stanceSummary}` : ''
                return `${i + 1}. ${turn.speaker}${stance}${summary}\n   回答：${turn.reply}`
            })
            .join('\n')

        const systemPrompt = `你正在参加一场结构化辩论，扮演的角色为：${constitution.name || '该角色'}。请严格遵守下列要求：\n
1) 以该角色的历史背景、知识与性格发言，避免使用角色在其去世后才出现的知识。\n
2) 辩论不是每轮都要“反着说”。你可以重申自己的观点、补充新的论据、承接上一位发言、部分同意对方、与上一位持相同观点，或在确有理由时再进行反驳；不要为了“辩论感”而强行把立场翻成相反方向。\n
3) 你会收到“辩题”“角色最近摘要”“本场辩论前文”和“最近发言”。请综合这些内容判断自己当前应如何回应，重点保持“像同一个人一直在说话”。\n
4) 如果上一位发言与你的观点一致，可以直接表示赞同并补充更有力的论据；如果观点不同，也可以选择回应、修正、保留分歧，而不是机械对立。\n
5) 当前生成的回答不得与本场辩论前文中任一条回复完全相同。即便立场相近，也应使用不同措辞、补充新的论据或对他人的观点做出点评；若确需重复要点，应为其做精炼重述或补充新信息，而非逐字复述。\n
6) 禁止输出内部推理或链式思考；不需引用外部资料；不要生成证据 ID。\n
7) 你的输出必须是严格 JSON，格式如下：\n{\n  "reply": "本轮真正要说的话",\n  "stance": "支持|反对|中立|同意并补充|部分同意|保留",\n  "stanceSummary": "一句话概括当前立场",\n  "keyPoints": ["要点1", "要点2"]\n}\n\n7) reply 必须很短：优先 1-2 句，尽量控制在 60 个汉字左右，最长不要超过 120 个汉字；stanceSummary 更短，尽量不超过 24 个汉字；keyPoints 只保留 1-3 个最重要的关键词。\n\n【辩题】${topic}\n\n【角色最近摘要】${memoryPack.summary || '无'}\n\n【本场辩论前文】\n${sessionTurns || '无'}\n\n【最近发言】\n${recentTurns || '无'}\n\n【当前要回应的内容】${input}\n\n请只输出 JSON，不要输出任何额外说明。`;

        try {
            const resp = await axios.post(
                `${API_URL}/chat/completions`,
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: input }
                    ],
                    temperature: 0.3,
                    max_tokens: 140
                },
                { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` } }
            )

            const raw = resp.data?.choices?.[0]?.message?.content || resp.data?.output || JSON.stringify(resp.data)
            const text = String(raw).replace(/```json\s*|```/g, '').trim()

            try {
                const parsed = JSON.parse(text)
                if (parsed && typeof parsed === 'object') {
                    const reply = clampDebateText(String(parsed.reply || text), 120)
                    const stanceSummary = clampDebateText(String(parsed.stanceSummary || reply), 24)
                    return {
                        reply,
                        meta: {
                            stance: String(parsed.stance || '中立').trim(),
                            stanceSummary,
                            keyPoints: Array.isArray(parsed.keyPoints)
                                ? parsed.keyPoints.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 3)
                                : []
                        }
                    }
                }
            } catch (_) {
                // fall through to text wrapper
            }

            return {
                reply: clampDebateText(text, 120),
                meta: {
                    stance: '中立',
                    stanceSummary: clampDebateText(text, 24),
                    keyPoints: []
                }
            }
        } catch (err: any) {
            console.error('DeepSeek debate call failed:', err.response?.data || err.message)
            throw err
        }
    }

    ,
    async generateReverseQuestion({ constitution, topic, input, memoryPack, stage }:
        { constitution: Constitution; topic: string; input: string; memoryPack: MemoryPack; stage?: string }): Promise<ReverseQuestionResult> {
        const API_KEY = process.env.DEEPSEEK_API_KEY
        const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1'
        if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured')

        const recentTurns = memoryPack.recent
            .map((t, i) => `${i + 1}. 用户回答：${t.user}\n   人物追问：${t.assistant}`)
            .join('\n')

        const systemPrompt = `你正在扮演历史人物 ${constitution.name || '该角色'}，现在不是回答用户，而是向用户发问，和用户进行一轮一轮的反向问答。

要求：
1) 你每次只提出一个问题，问题要简洁、有启发性，并且符合该人物的时代、知识和性格。
2) 问题应尽量承接“主题”和“上一轮用户回答”，并在此基础上继续追问。
3) 不要输出解释、称呼、前言、总结或链式思考；不要模拟 AI 身份。
4) 如果用户给出的内容过于宽泛，可先围绕主题追问一个更具体的问题。
5) 输出必须是严格 JSON，格式如下：
{
  "question": "你要问用户的问题",
  "focus": "这一问想聚焦的核心点"
}

【主题】${topic}

【当前输入】${input}

【最近反向问答】
${recentTurns || '无'}

请只输出 JSON，不要输出任何额外说明。`;

        try {
            const resp = await axios.post(
                `${API_URL}/chat/completions`,
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: input }
                    ],
                    temperature: 0.35,
                    max_tokens: 120
                },
                { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` } }
            )

            const raw = resp.data?.choices?.[0]?.message?.content || resp.data?.output || JSON.stringify(resp.data)
            const text = String(raw).replace(/```json\s*|```/g, '').trim()

            try {
                const parsed = JSON.parse(text)
                const question = clampDebateText(String(parsed.question || text), 120)
                const focus = clampDebateText(String(parsed.focus || question), 32)
                return { question, meta: { focus } }
            } catch (_) {
                return { question: clampDebateText(text, 120), meta: { focus: clampDebateText(text, 32) } }
            }
        } catch (err: any) {
            console.error('DeepSeek reverseQA call failed:', err.response?.data || err.message)
            throw err
        }
    }

    ,
    async generateEvidence({ constitution, query, limit = 3 }:
        { constitution: Constitution; query: string; limit?: number }) {
        const API_KEY = process.env.DEEPSEEK_API_KEY
        const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1'
        if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured')

        const system = `你将为角色提供可能的参考材料片段，用于回答用户问题。请严格遵守“参考”字段规范：\n\n1) 仅允许三类内容：\n   - 该人物在世时已存在的文献原文（需标明出处）\n   - 该人物自己的著作、书信、演讲记录\n   - 真实的历史事件、人物关系、当时的社会常识\n\n2) 严禁：\n   - 输出模型的思考或推理过程（如“我想到”/“我认为”/链式思考）\n   - 编造文献、书名、章节或不存在的来源\n   - 包含该人物去世后出现的知识、理论或事件\n   - 使用现代网络用语、AI术语或教科书式总结\n   - 使用任何标注性词语如“AI生成”“未经证实”“示例”等\n\n3) 输出格式严格要求：\n   - 仅返回合法的 JSON 数组（例如: [{"id":"a1","text":"证据文本"}, ...]），不要输出任何额外文字、注释或说明。\n   - 每条证据的 "text" 应为简短引用或出处描述（<=200字），不做解释性展开。\n\n4) 如果没有符合规范的强依据，返回空数组 []（不要返回解释或占位符文本）。`;
        const user = `角色说明：${constitution.instructions}\n问题：${query}\n请仅返回标准 JSON 数组，遵守上述规则（不允许任何额外说明文字）。`;

        const resp = await axios.post(
            `${API_URL}/chat/completions`,
            {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user }
                ],
                temperature: 0.3,
                max_tokens: 800
            },
            { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` } }
        )

        const text = resp.data?.choices?.[0]?.message?.content || resp.data?.output || JSON.stringify(resp.data)
        // try parse JSON (expect strict array). If not parseable, fallbacks below.
        try {
            const parsed = JSON.parse(String(text))
            if (Array.isArray(parsed)) {
                // sanitize entries: ensure text is concise and not a chain-of-thought
                const mapped = parsed.map((p: any, i: number) => ({ id: String(p.id || `ai-${Date.now()}-${i}`), text: String(p.text || '') }))
                const filtered = mapped.filter(it => {
                    const t = it.text.trim()
                    if (!t) return false
                    // drop if looks like internal reasoning or too long
                    if (t.length > 400) return false
                    const lower = t.toLowerCase()
                    if (lower.includes('思考') || lower.includes('我认为') || lower.includes('可能') || lower.includes('推测')) return false
                    return true
                })
                return filtered.slice(0, limit)
            }
        } catch (e) {
            // fallback: try to extract lines of the form {"id":...,"text":"..."}
        }

        // fallback parse: look for lines starting with { and parse
        const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        const out: Array<{ id: string; text: string }> = []
        for (const l of lines) {
            if (l.startsWith('{') && l.endsWith('}')) {
                try { const p = JSON.parse(l); out.push({ id: String(p.id || `ai-${Date.now()}`), text: String(p.text || '') }) } catch (_) { }
            }
            if (out.length >= limit) break
        }

        // final fallback: split by numbered lines, but filter out likely reasoning
        if (out.length === 0) {
            const items = String(text).split(/\n\d+\.|\n- /).map(s => s.trim()).filter(Boolean).slice(0, limit)
            items.forEach((it, i) => {
                const t = it.replace(/\s+/g, ' ').trim()
                if (t && t.length <= 400 && !/思考|我认为|推测|可能/.test(t)) out.push({ id: `ai-${Date.now()}-${i}`, text: t })
            })
        }

        return out.slice(0, limit)
    }

    ,
    async generateEmotionEcho({ constitution, input, emotionLabel }:
        { constitution: Constitution; input: string; emotionLabel: string }): Promise<EmotionEchoResult> {
        const API_KEY = process.env.DEEPSEEK_API_KEY
        const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1'
        if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured')

        const systemPrompt = `你正在扮演一位情绪共情者。用户的输入表达了某种情绪，你需要：
1) 先快速分析用户输入中的情绪倾向（如：悲伤、焦虑、愤怒、孤独、迷茫、喜悦、平和等），只输出一个简短标签。
2) 然后以历史人物 ${constitution.name || '该角色'} 的口吻，给出符合该人物性格、时代背景和知识范围的回应。
   - ${constitution.name} 应当用其时代的语言风格安慰、开导或回应用户的情感。
   - 不得使用现代心理学词汇、AI术语或角色去世后的知识。
   - 回应应温和、有哲理，且符合人物的核心思想（如孔子重仁、老子重道、庄子重逍遥等）。
3) 输出必须是严格 JSON，格式如下：
{
  "reply": "历史人物的回应正文",
  "emotionLabel": "检测到的情绪标签"
}

请只输出 JSON，不要输出任何额外说明。`;

        const userPrompt = `用户说：${input}`;

        try {
            const resp = await axios.post(
                `${API_URL}/chat/completions`,
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.4,
                    max_tokens: 300
                },
                { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` } }
            )

            const raw = resp.data?.choices?.[0]?.message?.content || resp.data?.output || JSON.stringify(resp.data)
            const text = String(raw).replace(/```json\s*|```/g, '').trim()

            try {
                const parsed = JSON.parse(text)
                const reply = clampDebateText(String(parsed.reply || text), 300)
                const label = clampDebateText(String(parsed.emotionLabel || '未识别'), 20)
                return { reply, emotionLabel: label }
            } catch (_) {
                return { reply: clampDebateText(text, 300), emotionLabel: '未识别' }
            }
        } catch (err: any) {
            console.error('DeepSeek emotionEcho call failed:', err.response?.data || err.message)
            throw err
        }
    },

    // Combined: analyze emotion, freely pick the best historical figure, and generate response in one LLM call
    async generateEmotionEchoWithAutoSelect(input: string): Promise<EmotionEchoResult & { selectedRole: string }> {
        const API_KEY = process.env.DEEPSEEK_API_KEY
        const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1'
        if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured')

        const systemPrompt = `你是一位情绪共情者。用户的输入表达了某种情绪，你需要完成以下任务：

1) 分析用户输入中的情绪倾向（如：悲伤、焦虑、愤怒、孤独、迷茫、喜悦、平和等），给出简短标签。
2) 从人类历史上所有人物中，自由选择一位最合适回应用户当前情绪的人物。考虑因素：
   - 此人的思想、言论、性格最能针对该情绪给出有深度、有共鸣的回应。
   - 此人的语言风格最适合安慰、开导或共情。
   - 尽量常见，但也不必局限于常见人物，可以大胆选择任何历史人物。
   - 少选择孔子等人物，而是一些让人眼前一亮的人物
   - 不要编造人物，少选择极其少为人知的人物.
3) 以你选择的历史人物的口吻，给出符合该人物性格、时代背景和知识范围的回应。
   - 使用其时代的语言风格，不得使用现代心理学词汇、AI术语或人物去世后的知识。
   - 回应应温和、有哲理，且符合该人物的核心思想。

4) 输出必须是严格 JSON，格式如下：
{
  "selectedRole": "选择的人物名称",
  "reply": "该历史人物的回应正文",
  "emotionLabel": "检测到的情绪标签"
}

请只输出 JSON，不要输出任何额外说明。`;

        try {
            const resp = await axios.post(
                `${API_URL}/chat/completions`,
                {
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `用户说：${input}` }
                    ],
                    temperature: 0.5,
                    max_tokens: 500
                },
                { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` } }
            )

            const raw = resp.data?.choices?.[0]?.message?.content || resp.data?.output || JSON.stringify(resp.data)
            const text = String(raw).replace(/```json\s*|```/g, '').trim()

            try {
                const parsed = JSON.parse(text)
                const reply = clampDebateText(String(parsed.reply || text), 400)
                const label = clampDebateText(String(parsed.emotionLabel || '未识别'), 20)
                const selectedRole = String(parsed.selectedRole || '').trim()
                return { reply, emotionLabel: label, selectedRole: selectedRole || '未知人物' }
            } catch (_) {
                return { reply: clampDebateText(text, 300), emotionLabel: '未识别', selectedRole: '未知人物' }
            }
        } catch (err: any) {
            console.error('DeepSeek emotionEcho auto-select call failed:', err.response?.data || err.message)
            throw err
        }
    },
}
