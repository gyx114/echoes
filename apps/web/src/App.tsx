import React, { useState, useEffect } from 'react'

type LocalTurn = { user: string; assistant: string; ts: number }
type HistoryStore = Record<string, LocalTurn[]>
type ReverseQAMessage = { speaker: string; text: string; ts: number }
type ReverseQASession = { id: string; role: string; topic: string; messages: ReverseQAMessage[]; createdAt: number; updatedAt: number }
type EmotionEchoRecord = { input: string; reply: string; emotionLabel: string; selectedRole: string; ts: number }

export default function App() {
    const [role, setRole] = useState('孔子')
    const apiBase = (() => {
        const envBase = (import.meta as any).env?.VITE_API_BASE
        if (envBase) return envBase
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            return 'http://localhost:4000'
        }
        return '/api'
    })()
    const [input, setInput] = useState('什么是仁？')
    const [customRole, setCustomRole] = useState('')
    const [roles, setRoles] = useState<string[]>(['孔子', '孟子', '老子', '庄子', '自定义'])
    const [reply, setReply] = useState<string | null>(null)
    const [evidence, setEvidence] = useState<any>(null)
    const [expandedEvidence, setExpandedEvidence] = useState<number[]>([])
    const [userId, setUserId] = useState<string | null>(null)
    const [page, setPage] = useState<'chat' | 'history' | 'debate' | 'debateHistory' | 'reverseQA' | 'reverseQAHistory' | 'emotionEcho' | 'emotionEchoHistory'>('chat')
    const [historyStore, setHistoryStore] = useState<HistoryStore>({})
    const [selectedHistoryRole, setSelectedHistoryRole] = useState('')
    const [exportFormat, setExportFormat] = useState<'markdown' | 'txt'>('markdown')
    // debate states
    const [debateTopic, setDebateTopic] = useState('孔子与仁的本质应如何理解？')
    const [debateParticipants, setDebateParticipants] = useState<string[]>(['', '', ''])
    const [debatesList, setDebatesList] = useState<DebateRecord[]>([])
    const [selectedDebateId, setSelectedDebateId] = useState<string | null>(null)
    const [debateActiveSlot, setDebateActiveSlot] = useState(0)
    const [isDebating, setIsDebating] = useState(false)
    const [liveDebate, setLiveDebate] = useState<DebateRecord | null>(null)
    const debateStageRef = React.useRef<HTMLDivElement | null>(null)
    const debateTopicRef = React.useRef<HTMLInputElement | null>(null)
    const debateAbortRef = React.useRef<AbortController | null>(null)
    const stopRequestedRef = React.useRef(false)
    const debateCustomRef = React.useRef<HTMLInputElement | null>(null)

    const [isSending, setIsSending] = useState(false)
    const [reverseQATopic, setReverseQATopic] = useState('请围绕“仁”的理解连续向我发问。')
    const [reverseQAInput, setReverseQAInput] = useState('')
    const [reverseQAMessages, setReverseQAMessages] = useState<ReverseQAMessage[]>([])
    const [reverseQASessions, setReverseQASessions] = useState<ReverseQASession[]>([])
    const [selectedReverseQASessionId, setSelectedReverseQASessionId] = useState<string | null>(null)
    const [reverseQADraftMode, setReverseQADraftMode] = useState(false)
    const [isReverseQASending, setIsReverseQASending] = useState(false)
    const [reverseQAQuestion, setReverseQAQuestion] = useState('（尚未开始）')
    const reverseQAImportRef = React.useRef<HTMLInputElement | null>(null)

    // emotion echo states
    const [emotionInput, setEmotionInput] = useState('我今天很难过')
    const [emotionReply, setEmotionReply] = useState<string | null>(null)
    const [emotionLabel, setEmotionLabel] = useState<string | null>(null)
    const [emotionSelectedRole, setEmotionSelectedRole] = useState<string | null>(null)
    const [isEmotionSending, setIsEmotionSending] = useState(false)
    const [emotionEchoHistoryStore, setEmotionEchoHistoryStore] = useState<EmotionEchoRecord[]>([])
    const [sidebarOpen, setSidebarOpen] = useState(false)

    function genClientMessageId() {
        return `c-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
    }

    function reverseQASessionStorageKey(uid: string) {
        return `echoes.reverseqa.${uid}`
    }

    function loadLocalReverseQASessions(uid: string): ReverseQASession[] {
        try {
            const raw = localStorage.getItem(reverseQASessionStorageKey(uid))
            if (!raw) return []
            return JSON.parse(raw) as ReverseQASession[]
        } catch (e) {
            console.warn('load reverseQA sessions failed', e)
            return []
        }
    }

    function saveLocalReverseQASession(uid: string, session: ReverseQASession) {
        try {
            const list = loadLocalReverseQASessions(uid)
            const index = list.findIndex(item => item.id === session.id)
            if (index >= 0) list[index] = session
            else list.unshift(session)
            while (list.length > 50) list.pop()
            localStorage.setItem(reverseQASessionStorageKey(uid), JSON.stringify(list))
        } catch (e) {
            console.warn('save reverseQA session failed', e)
        }
    }

    function deleteLocalReverseQASession(uid: string, id: string) {
        try {
            const list = loadLocalReverseQASessions(uid).filter(item => item.id !== id)
            localStorage.setItem(reverseQASessionStorageKey(uid), JSON.stringify(list))
        } catch (e) {
            console.warn('delete reverseQA session failed', e)
        }
    }

    function refreshReverseQASessions(uid: string, preferredId?: string) {
        const list = loadLocalReverseQASessions(uid)
        setReverseQASessions(list)
        const nextId = preferredId || list[0]?.id || null
        setSelectedReverseQASessionId(nextId)
        const current = nextId ? list.find(item => item.id === nextId) : null
        if (current) {
            setReverseQATopic(current.topic)
            setReverseQAMessages(current.messages.slice())
            const lastMessage = current.messages[current.messages.length - 1]
            setReverseQAQuestion(lastMessage?.speaker && lastMessage.speaker !== '用户' ? lastMessage.text : '（尚未开始）')
        } else {
            setReverseQATopic('请围绕“仁”的理解连续向我发问。')
            setReverseQAMessages([])
            setReverseQAQuestion('（尚未开始）')
        }
        return list
    }

    function syncReverseQASessionList(uid: string) {
        const list = loadLocalReverseQASessions(uid)
        setReverseQASessions(list)
        return list
    }

    function persistReverseQASession(uid: string, sessionId: string, roleName: string, topic: string, messages: ReverseQAMessage[]) {
        const session: ReverseQASession = {
            id: sessionId,
            role: roleName,
            topic,
            messages: messages.slice(),
            createdAt: messages[0]?.ts || Date.now(),
            updatedAt: Date.now()
        }
        saveLocalReverseQASession(uid, session)
        refreshReverseQASessions(uid, sessionId)
    }

    function buildReverseQAExport(sessionId: string, format: 'markdown' | 'txt') {
        const session = reverseQASessions.find(item => item.id === sessionId)
        if (!session) return ''
        const generatedAt = new Date().toLocaleString()
        if (format === 'txt') {
            const lines: string[] = []
            lines.push(`角色：${session.role}`)
            lines.push(`话题：${session.topic}`)
            lines.push(`创建时间：${new Date(session.createdAt).toLocaleString()}`)
            lines.push(`导出时间：${generatedAt}`)
            lines.push('')
            session.messages.forEach((message, index) => {
                lines.push(`【第 ${index + 1} 条】`)
                lines.push(`说话人：${message.speaker}`)
                lines.push(`时间：${new Date(message.ts).toLocaleString()}`)
                lines.push(message.text)
                lines.push('')
            })
            return lines.join('\n')
        }

        const lines: string[] = []
        lines.push(`# 反向问答：${session.topic}`)
        lines.push('')
        lines.push(`- 角色：${session.role}`)
        lines.push(`- 创建时间：${new Date(session.createdAt).toLocaleString()}`)
        lines.push(`- 导出时间：${generatedAt}`)
        lines.push('')
        session.messages.forEach((message, index) => {
            lines.push(`## 第 ${index + 1} 条`)
            lines.push('')
            lines.push(`- 说话人：${message.speaker}`)
            lines.push(`- 时间：${new Date(message.ts).toLocaleString()}`)
            lines.push('')
            lines.push('```text')
            lines.push(message.text)
            lines.push('```')
            lines.push('')
        })
        return lines.join('\n')
    }

    function parseReverseQAExportHeader(lines: string[]) {
        const session: Partial<ReverseQASession> = { messages: [] }
        const meta = { role: '', topic: '', createdAt: Date.now() }
        for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line) continue
            if (line.startsWith('角色：')) meta.role = line.slice(3).trim()
            else if (line.startsWith('人物：')) meta.role = line.slice(3).trim()
            else if (line.startsWith('话题：')) meta.topic = line.slice(3).trim()
            else if (line.startsWith('创建时间：')) {
                const ts = Date.parse(line.slice(5).trim())
                if (!Number.isNaN(ts)) meta.createdAt = ts
            }
            else if (line.startsWith('- 角色：')) meta.role = line.slice(5).trim()
            else if (line.startsWith('- 人物：')) meta.role = line.slice(5).trim()
            else if (line.startsWith('- 创建时间：')) {
                const ts = Date.parse(line.slice(7).trim())
                if (!Number.isNaN(ts)) meta.createdAt = ts
            }
            else if (line.startsWith('# 反向问答：')) meta.topic = line.slice(7).trim()
            else if (line.startsWith('# 反向问答')) meta.topic = line.replace(/^#\s*反向问答[:：]?\s*/u, '').trim()
            else if (line.startsWith('#')) continue
        }
        session.role = meta.role || '未知人物'
        session.topic = meta.topic || '未命名反向问答'
        session.createdAt = meta.createdAt
        return session as Pick<ReverseQASession, 'role' | 'topic' | 'createdAt'>
    }

    function parseReverseQAExportMessages(lines: string[]) {
        const messages: ReverseQAMessage[] = []
        let speaker = ''
        let messageTime = Date.now()
        let buffer: string[] = []
        let inCodeBlock = false
        let started = false

        const flush = () => {
            const text = buffer.join('\n').trim()
            if (text.length > 0) {
                messages.push({ speaker: speaker || '人物', text, ts: messageTime })
            }
            speaker = ''
            messageTime = Date.now()
            buffer = []
        }

        for (const rawLine of lines) {
            const line = rawLine.trimEnd()
            const trimmed = line.trim()
            if (trimmed.startsWith('## 第 ') && trimmed.includes('条')) {
                started = true
                if (buffer.length > 0) flush()
                continue
            }
            if (trimmed === '```text' || trimmed === '```') {
                inCodeBlock = !inCodeBlock
                continue
            }
            if (!started) continue
            if (trimmed.startsWith('- 说话人：')) {
                speaker = trimmed.slice(6).trim()
                continue
            }
            if (trimmed.startsWith('说话人：')) {
                speaker = trimmed.slice(4).trim()
                continue
            }
            if (trimmed.startsWith('- 时间：')) {
                const ts = Date.parse(trimmed.slice(5).trim())
                if (!Number.isNaN(ts)) messageTime = ts
                continue
            }
            if (trimmed.startsWith('时间：')) {
                const ts = Date.parse(trimmed.slice(3).trim())
                if (!Number.isNaN(ts)) messageTime = ts
                continue
            }
            if (trimmed.startsWith('【第 ') && trimmed.includes('条】')) {
                started = true
                if (buffer.length > 0) flush()
                continue
            }
            if (!trimmed && !inCodeBlock && buffer.length === 0) continue
            buffer.push(line)
        }

        if (buffer.length > 0) flush()
        return messages.filter(message => message.text.trim().length > 0)
    }

    function importReverseQASessionsFromText(text: string) {
        const trimmed = text.trim()
        if (!trimmed) return []

        try {
            const parsed = JSON.parse(trimmed)
            const list = Array.isArray(parsed)
                ? parsed
                : Array.isArray(parsed?.sessions)
                    ? parsed.sessions
                    : parsed
                        ? [parsed]
                        : []
            const sessions = list.map(normalizeReverseQASession).filter(Boolean) as ReverseQASession[]
            if (sessions.length > 0) return sessions
        } catch (_) {
            // fall through to md/txt parsing
        }

        const lines = trimmed.split(/\r?\n/u)
        const header = parseReverseQAExportHeader(lines)
        const messages = parseReverseQAExportMessages(lines)
        if (messages.length === 0) return []

        return [{
            id: `reverseqa-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            role: header.role,
            topic: header.topic,
            messages,
            createdAt: header.createdAt || messages[0]?.ts || Date.now(),
            updatedAt: Date.now()
        }]
    }

    function exportSelectedReverseQASession() {
        if (!userId || !selectedReverseQASessionId) return
        const content = buildReverseQAExport(selectedReverseQASessionId, exportFormat)
        if (!content) return
        const safe = selectedReverseQASessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
        const ext = exportFormat === 'markdown' ? 'md' : 'txt'
        const filename = `echoes-reverseqa-${safe}-${new Date().toISOString().slice(0, 10)}.${ext}`
        const mime = exportFormat === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
        triggerDownload(filename, content, mime)
    }

    function normalizeReverseQASession(raw: any): ReverseQASession | null {
        if (!raw || typeof raw !== 'object') return null
        const id = String(raw.id || `reverseqa-${Date.now()}`)
        const roleName = String(raw.role || '未知人物')
        const topic = String(raw.topic || '未命名反向问答')
        const messages = Array.isArray(raw.messages)
            ? raw.messages.map((msg: any) => ({
                speaker: String(msg?.speaker || '人物'),
                text: String(msg?.text || ''),
                ts: Number(msg?.ts || Date.now())
            })).filter((msg: ReverseQAMessage) => msg.text.trim().length > 0)
            : []
        return {
            id,
            role: roleName,
            topic,
            messages,
            createdAt: Number(raw.createdAt || messages[0]?.ts || Date.now()),
            updatedAt: Number(raw.updatedAt || Date.now())
        }
    }

    const debateFixedRoles = roles.filter(name => name !== '自定义')

    const debateQuickSelectCustomValue = '__custom__'

    function getDebateQuickSelectValue(value: string) {
        return debateFixedRoles.includes(value) ? value : debateQuickSelectCustomValue
    }

    function getOrCreateLocalUserId() {
        const key = 'echoes.userId'
        let id = localStorage.getItem(key)
        if (!id) {
            id = `user-${Date.now()}-${Math.floor(Math.random() * 10000)}`
            localStorage.setItem(key, id)
        }
        return id
    }

    function localStorageKey(uid: string) {
        return `echoes.history.${uid}`
    }

    function loadLocalHistoryStore(uid: string) {
        try {
            const raw = localStorage.getItem(localStorageKey(uid))
            if (!raw) return {} as HistoryStore
            return JSON.parse(raw || '{}') as HistoryStore
        } catch (e) {
            console.warn('load history failed', e)
            return {} as HistoryStore
        }
    }

    function loadLocalHistory(uid: string, roleName: string) {
        const all = loadLocalHistoryStore(uid)
        return all[roleName] ? all[roleName].slice().reverse() : []
    }

    function saveLocalTurn(uid: string, roleName: string, turn: LocalTurn) {
        try {
            const key = localStorageKey(uid)
            const raw = localStorage.getItem(key)
            const all = raw ? JSON.parse(raw) as HistoryStore : {}
            const list = all[roleName] || []
            list.push(turn)
            // cap to 50 most recent
            while (list.length > 50) list.shift()
            all[roleName] = list
            localStorage.setItem(key, JSON.stringify(all))
        } catch (e) {
            console.warn('save history failed', e)
        }
    }

    function deleteLocalHistoryRole(uid: string, roleName: string) {
        try {
            const key = localStorageKey(uid)
            const raw = localStorage.getItem(key)
            if (!raw) return
            const all = JSON.parse(raw) as HistoryStore
            delete all[roleName]
            localStorage.setItem(key, JSON.stringify(all))
        } catch (e) {
            console.warn('delete role history failed', e)
        }
    }

    function deleteLocalHistoryTurn(uid: string, roleName: string, turnIndex: number) {
        try {
            const key = localStorageKey(uid)
            const raw = localStorage.getItem(key)
            if (!raw) return
            const all = JSON.parse(raw) as HistoryStore
            const list = all[roleName]
            if (!Array.isArray(list) || turnIndex < 0 || turnIndex >= list.length) return
            list.splice(turnIndex, 1)
            if (list.length === 0) {
                delete all[roleName]
            } else {
                all[roleName] = list
            }
            localStorage.setItem(key, JSON.stringify(all))
        } catch (e) {
            console.warn('delete turn history failed', e)
        }
    }

    function getSortedHistoryRoles(store: HistoryStore) {
        return Object.entries(store)
            .filter(([, turns]) => Array.isArray(turns) && turns.length > 0)
            .sort((a, b) => (b[1][b[1].length - 1]?.ts || 0) - (a[1][a[1].length - 1]?.ts || 0))
            .map(([name, turns]) => ({ name, turns }))
    }

    function refreshHistory(uid: string, preferredRole?: string) {
        const store = loadLocalHistoryStore(uid)
        setHistoryStore(store)
        const rolesInStore = getSortedHistoryRoles(store)
        const nextRole = preferredRole || rolesInStore[0]?.name || ''
        setSelectedHistoryRole(nextRole)
        return { store, nextRole }
    }

    function refreshHistoryPreservingSelection(uid: string, currentRole: string) {
        const store = loadLocalHistoryStore(uid)
        setHistoryStore(store)
        const nextRole = store[currentRole]?.length ? currentRole : getSortedHistoryRoles(store)[0]?.name || ''
        setSelectedHistoryRole(nextRole)
        return { store, nextRole }
    }

    function buildHistoryExport(roleName: string, turns: LocalTurn[], format: 'markdown' | 'txt') {
        const title = `Echoes 历史对话 - ${roleName}`
        const generatedAt = new Date().toLocaleString()
        if (format === 'txt') {
            const lines = [
                title,
                `导出时间：${generatedAt}`,
                '',
                ...turns.flatMap((turn, index) => [
                    `【第 ${index + 1} 轮】`,
                    `时间：${new Date(turn.ts).toLocaleString()}`,
                    `用户：${turn.user}`,
                    `助手：${turn.assistant}`,
                    ''
                ])
            ]
            return lines.join('\n')
        }

        const lines = [
            `# ${title}`,
            '',
            `- 导出时间：${generatedAt}`,
            `- 人物：${roleName}`,
            `- 对话轮数：${turns.length}`,
            '',
            ...turns.flatMap((turn, index) => [
                `## 第 ${index + 1} 轮`,
                '',
                `- 时间：${new Date(turn.ts).toLocaleString()}`,
                '',
                '### 用户',
                '```text',
                turn.user,
                '```',
                '',
                '### 助手',
                '```text',
                turn.assistant,
                '```',
                ''
            ])
        ]
        return lines.join('\n')
    }

    // Debate storage
    type DebateMessage = { speaker: string; text: string; ts: number; meta?: { stance: string; stanceSummary: string; keyPoints: string[] } }
    type DebateRecord = { id: string; topic: string; participants: string[]; messages: DebateMessage[]; createdAt: number }

    function debateStorageKey(uid: string) {
        return `echoes.debate.${uid}`
    }

    function loadLocalDebates(uid: string): DebateRecord[] {
        try {
            const raw = localStorage.getItem(debateStorageKey(uid))
            if (!raw) return []
            return JSON.parse(raw) as DebateRecord[]
        } catch (e) {
            console.warn('load debates failed', e)
            return []
        }
    }

    function saveLocalDebate(uid: string, rec: DebateRecord) {
        try {
            const list = loadLocalDebates(uid)
            list.unshift(rec)
            while (list.length > 100) list.pop()
            localStorage.setItem(debateStorageKey(uid), JSON.stringify(list))
        } catch (e) {
            console.warn('save debate failed', e)
        }
    }

    function deleteLocalDebate(uid: string, id: string) {
        try {
            const list = loadLocalDebates(uid).filter(d => d.id !== id)
            localStorage.setItem(debateStorageKey(uid), JSON.stringify(list))
        } catch (e) { console.warn('delete debate failed', e) }
    }

    function buildDebateContext(messages: DebateMessage[]) {
        return messages.map((msg, index) => ({
            turnIndex: index + 1,
            speaker: msg.speaker,
            reply: msg.text,
            stance: msg.meta?.stance || '中立',
            stanceSummary: msg.meta?.stanceSummary || ''
        }))
    }


    function triggerDownload(filename: string, content: string, mimeType: string) {
        const blob = new Blob([content], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
    }

    async function runDebate(uid: string, topic: string, participants: string[]) {
        // orchestrate 3 rounds, each participant speaks in turn
        if (!participants || participants.length === 0) return null
        setIsDebating(true)
        const messages: DebateMessage[] = []
        const liveId = `live-${Date.now()}`
        const liveRec: DebateRecord = { id: liveId, topic, participants: participants.slice(), messages: [], createdAt: Date.now() }
        setLiveDebate(liveRec)
        setSelectedDebateId(liveId)
        let lastStatement = topic
        try {
            stopRequestedRef.current = false
            debateAbortRef.current = null
            for (let round = 1; round <= 3; round++) {
                for (let pi = 0; pi < participants.length; pi++) {
                    if (stopRequestedRef.current) return messages
                    const speaker = participants[pi]
                    const roleToSend = speaker === '自定义' ? speaker : speaker
                    // prepare abort controller for this request
                    try {
                        const controller = new AbortController()
                        debateAbortRef.current = controller
                        const res = await fetch(`${apiBase}/chat`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                role: roleToSend,
                                input: lastStatement,
                                debateTopic: topic,
                                debateContext: JSON.stringify(buildDebateContext(messages)),
                                userId: uid,
                                mode: 'debate'
                            }),
                            signal: controller.signal
                        })
                        const data = await res.json()
                        const text = data.reply || ''
                        const msg: DebateMessage = {
                            speaker,
                            text,
                            ts: Date.now(),
                            meta: data.debateMeta || undefined
                        }
                        messages.push(msg)
                        // update live debate immediately
                        setLiveDebate(prev => prev ? { ...prev, messages: [...prev.messages, msg] } : prev)
                        // scroll to bottom
                        try { debateStageRef.current?.scrollTo({ top: debateStageRef.current.scrollHeight, behavior: 'smooth' }) } catch (_) { }
                        lastStatement = text

                        // pause a bit between replies so the conversation is easier to read
                        const isLastMessage = round === 3 && pi === participants.length - 1
                        if (!isLastMessage) {
                            // check for stop during wait
                            await new Promise(resolve => {
                                const t = window.setTimeout(() => { window.clearTimeout(t); resolve(null) }, 3000)
                            })
                            if (stopRequestedRef.current) return messages
                        }
                    } catch (err: any) {
                        // if aborted, stop gracefully
                        if (err && (err.name === 'AbortError' || stopRequestedRef.current)) {
                            return messages
                        }
                        console.warn('debate generation failed', err)
                        return messages
                    } finally {
                        debateAbortRef.current = null
                    }
                }
            }
        } catch (e) {
            console.warn('debate generation failed', e)
        }
        // persist final debate record
        const rec: DebateRecord = { id: `debate-${Date.now()}`, topic, participants: participants.slice(), messages: messages.slice(), createdAt: Date.now() }
        try { saveLocalDebate(uid, rec); } catch (e) { /* ignore */ }
        // refresh list and select persisted record
        refreshDebates(uid)
        setSelectedDebateId(rec.id)
        setLiveDebate(null)
        setIsDebating(false)
        return messages
    }

    function refreshDebates(uid: string) {
        const list = loadLocalDebates(uid)
        setDebatesList(list)
        setSelectedDebateId(list[0]?.id || null)
    }

    function renderSelectedDebate() {
        const rec = debatesList.find(d => d.id === selectedDebateId)
        if (!rec) return <p className="muted">（该辩论已删除）</p>
        if (rec.messages.length === 0) return <p className="muted">（该辩论暂无内容）</p>
        return rec.messages.map((m, idx) => (
            <div key={`${m.ts}-${idx}`} className={`debate-bubble ${idx % 2 === 0 ? 'left' : 'right'}`}>
                <div className="debate-meta">{m.speaker} · {new Date(m.ts).toLocaleTimeString()}</div>
                <div className="debate-text">{m.text}</div>
            </div>
        ))
    }

    function buildDebateExport(debateId: string, format: 'markdown' | 'txt') {
        const rec = (debatesList.find(d => d.id === debateId) || (liveDebate && liveDebate.id === debateId ? liveDebate : null)) as DebateRecord | null
        if (!rec) return ''
        const generatedAt = new Date().toLocaleString()
        if (format === 'txt') {
            const lines: string[] = []
            lines.push(`辩题：${rec.topic}`)
            lines.push(`参与者：${rec.participants.join(' / ')}`)
            lines.push(`创建时间：${new Date(rec.createdAt).toLocaleString()}`)
            lines.push('')
            rec.messages.forEach((m, i) => {
                lines.push(`【${i + 1}】 ${m.speaker} (${new Date(m.ts).toLocaleString()}):`)
                lines.push(m.text)
                lines.push('')
            })
            return lines.join('\n')
        }

        const md: string[] = []
        md.push(`# 辩题：${rec.topic}`)
        md.push('')
        md.push(`- 参与者：${rec.participants.join(' / ')}`)
        md.push(`- 创建时间：${new Date(rec.createdAt).toLocaleString()}`)
        md.push('')
        rec.messages.forEach((m, i) => {
            md.push(`## 第 ${i + 1} 条`)
            md.push('')
            md.push(`- 说话人：${m.speaker}`)
            md.push(`- 时间：${new Date(m.ts).toLocaleString()}`)
            md.push('')
            md.push('```text')
            md.push(m.text)
            md.push('```')
            md.push('')
        })
        return md.join('\n')
    }

    function exportSelectedDebate() {
        if (!userId || !selectedDebateId) return
        const content = buildDebateExport(selectedDebateId, exportFormat)
        if (!content) return
        const safe = (selectedDebateId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
        const ext = exportFormat === 'markdown' ? 'md' : 'txt'
        const filename = `echoes-debate-${safe}-${new Date().toISOString().slice(0, 10)}.${ext}`
        const mime = exportFormat === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
        triggerDownload(filename, content, mime)
    }

    function openDebateHistory() {
        const uid = userId || getOrCreateLocalUserId()
        setUserId(uid)
        refreshDebates(uid)
        setPage('debateHistory')
    }

    function openReverseQA() {
        const uid = userId || getOrCreateLocalUserId()
        setUserId(uid)
        setReverseQADraftMode(false)
        syncReverseQASessionList(uid)
        setPage('reverseQA')
    }

    function startNewReverseQASession() {
        const uid = userId || getOrCreateLocalUserId()
        setUserId(uid)
        setReverseQADraftMode(true)
        setSelectedReverseQASessionId(null)
        setReverseQATopic('请围绕“仁”的理解连续向我发问。')
        setReverseQAInput('')
        setReverseQAMessages([])
        setReverseQAQuestion('（尚未开始）')
        setPage('reverseQA')
    }

    function loadReverseQASession(sessionId: string) {
        const uid = userId || getOrCreateLocalUserId()
        const session = reverseQASessions.find(item => item.id === sessionId)
        if (!session) return
        setUserId(uid)
        setReverseQADraftMode(false)
        setSelectedReverseQASessionId(session.id)
        setReverseQATopic(session.topic)
        setReverseQAMessages(session.messages.slice())
        const lastMessage = session.messages[session.messages.length - 1]
        setReverseQAQuestion(lastMessage?.speaker && lastMessage.speaker !== '用户' ? lastMessage.text : '（尚未开始）')
        setReverseQAInput('')
        setPage('reverseQA')
    }

    function removeReverseQASession(sessionId: string) {
        if (!userId) return
        deleteLocalReverseQASession(userId, sessionId)
        refreshReverseQASessions(userId, selectedReverseQASessionId === sessionId ? undefined : selectedReverseQASessionId || undefined)
    }

    function toggleReverseQAHistory() {
        const uid = userId || getOrCreateLocalUserId()
        setUserId(uid)
        setReverseQADraftMode(false)
        syncReverseQASessionList(uid)
        setPage('reverseQAHistory')
    }

    // Emotion echo storage
    function emotionEchoStorageKey(uid: string) {
        return `echoes.emotionEcho.${uid}`
    }

    function loadEmotionEchoHistory(uid: string): EmotionEchoRecord[] {
        try {
            const raw = localStorage.getItem(emotionEchoStorageKey(uid))
            return raw ? JSON.parse(raw) : []
        } catch { return [] }
    }

    function saveEmotionEchoTurn(uid: string, record: EmotionEchoRecord) {
        try {
            const key = emotionEchoStorageKey(uid)
            const list = loadEmotionEchoHistory(uid)
            list.push(record)
            // cap at 200 entries
            while (list.length > 200) list.shift()
            localStorage.setItem(key, JSON.stringify(list))
        } catch (e) {
            console.warn('save emotionEcho history failed', e)
        }
    }

    function deleteEmotionEchoTurn(uid: string, index: number) {
        try {
            const key = emotionEchoStorageKey(uid)
            const list = loadEmotionEchoHistory(uid)
            if (index < 0 || index >= list.length) return
            list.splice(index, 1)
            localStorage.setItem(key, JSON.stringify(list))
        } catch (e) {
            console.warn('delete emotionEcho turn failed', e)
        }
    }

    function clearEmotionEchoHistory(uid: string) {
        try {
            localStorage.removeItem(emotionEchoStorageKey(uid))
        } catch (e) {
            console.warn('clear emotionEcho history failed', e)
        }
    }

    function buildEmotionEchoExport(records: EmotionEchoRecord[], format: 'markdown' | 'txt') {
        const generatedAt = new Date().toLocaleString()
        if (format === 'txt') {
            const lines = [
                'Echoes 情绪回响记录',
                `导出时间：${generatedAt}`,
                `条目数：${records.length}`,
                '',
                ...records.flatMap((r, i) => [
                    `【第 ${i + 1} 条】`,
                    `时间：${new Date(r.ts).toLocaleString()}`,
                    `情绪：${r.emotionLabel}`,
                    `回应人物：${r.selectedRole}`,
                    `用户：${r.input}`,
                    `回应：${r.reply}`,
                    ''
                ])
            ]
            return lines.join('\n')
        }
        const lines = [
            '# Echoes 情绪回响记录',
            '',
            `- 导出时间：${generatedAt}`,
            `- 条目数：${records.length}`,
            '',
            ...records.flatMap((r, i) => [
                `## 第 ${i + 1} 条`,
                '',
                `- 时间：${new Date(r.ts).toLocaleString()}`,
                `- 情绪：${r.emotionLabel}`,
                `- 回应人物：${r.selectedRole}`,
                '',
                '### 用户输入',
                '```text',
                r.input,
                '```',
                '',
                '### 历史人物回应',
                '```text',
                r.reply,
                '```',
                ''
            ])
        ]
        return lines.join('\n')
    }

    function refreshEmotionEchoHistory(uid: string) {
        const list = loadEmotionEchoHistory(uid)
        setEmotionEchoHistoryStore(list)
        return list
    }

    async function importReverseQAFile(file: File) {
        const uid = userId || getOrCreateLocalUserId()
        const text = await file.text()
        const imported = importReverseQASessionsFromText(text)
        if (imported.length === 0) return
        imported.forEach(session => saveLocalReverseQASession(uid, session))
        setReverseQADraftMode(false)
        refreshReverseQASessions(uid, imported[0].id)
        setSelectedReverseQASessionId(imported[0].id)
        setPage('reverseQAHistory')
    }


    function exportSelectedHistory() {
        if (!userId || !selectedHistoryRole) return
        const turns = (historyStore[selectedHistoryRole] || []).slice().reverse()
        if (turns.length === 0) return
        const extension = exportFormat === 'markdown' ? 'md' : 'txt'
        const mimeType = exportFormat === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
        const content = buildHistoryExport(selectedHistoryRole, turns, exportFormat)
        const safeRole = selectedHistoryRole.replace(/[\\/:*?"<>|]/g, '_')
        const filename = `echoes-${safeRole}-${new Date().toISOString().slice(0, 10)}.${extension}`
        triggerDownload(filename, content, mimeType)
    }

    function clearSelectedRoleHistory() {
        if (!userId || !selectedHistoryRole) return
        deleteLocalHistoryRole(userId, selectedHistoryRole)
        refreshHistoryPreservingSelection(userId, selectedHistoryRole)
    }

    function removeSelectedRoleTurn(turnIndex: number) {
        if (!userId || !selectedHistoryRole) return
        deleteLocalHistoryTurn(userId, selectedHistoryRole, turnIndex)
        refreshHistoryPreservingSelection(userId, selectedHistoryRole)
    }

    async function send() {
        const trimmed = (input || '').trim()
        if (!trimmed) return
        if (isSending) return

        setIsSending(true)
        setReply('加载中...')
        const roleToSend = role === '自定义' ? (customRole || '未知人物') : role
        const uid = userId || getOrCreateLocalUserId()
        if (!userId) setUserId(uid)

        const clientMessageId = genClientMessageId()
        let data: any = null
        try {
            const res = await fetch(`${apiBase}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: roleToSend, input: trimmed, userId: uid, clientMessageId })
            })
            data = await res.json()
            setReply(data.reply)
            setEvidence(data.evidence)
            setExpandedEvidence([])

            // save locally
            const turn: LocalTurn = { user: trimmed, assistant: data.reply || '', ts: Date.now() }
            saveLocalTurn(uid, roleToSend, turn)
            // refresh history view if open
            if (page === 'history') refreshHistoryPreservingSelection(uid, roleToSend)
        } catch (err) {
            console.warn('send failed', err)
            setReply('请求失败，请稍后重试')
        } finally {
            setIsSending(false)
        }
    }

    async function sendReverseQA() {
        const topic = (reverseQATopic || '').trim()
        const answer = (reverseQAInput || '').trim()
        const isFirstQuestion = reverseQAMessages.length === 0
        const stage = isFirstQuestion ? 'start' : 'answer'
        const contentToSend = isFirstQuestion ? topic : answer

        if (!topic) return
        if (!isFirstQuestion && !answer) return
        if (isReverseQASending) return

        setIsReverseQASending(true)
        const roleToSend = role === '自定义' ? (customRole || '未知人物') : role
        const uid = userId || getOrCreateLocalUserId()
        if (!userId) setUserId(uid)

        const sessionId = selectedReverseQASessionId || `reverseqa-${Date.now()}`
        const clientMessageId = genClientMessageId()
        const nextMessages: ReverseQAMessage[] = isFirstQuestion
            ? reverseQAMessages.slice()
            : [...reverseQAMessages, { speaker: '用户', text: answer, ts: Date.now() }]

        try {
            const res = await fetch(`${apiBase}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: roleToSend,
                    input: contentToSend,
                    userId: uid,
                    mode: 'reverseQA',
                    reverseTopic: topic,
                    reverseStage: stage,
                    clientMessageId
                })
            })
            const data = await res.json()
            const question = String(data.reply || '').trim()
            if (!question) {
                throw new Error('empty reverseQA reply')
            }

            const updatedMessages: ReverseQAMessage[] = [...nextMessages, { speaker: roleToSend, text: question, ts: Date.now() }]
            setReverseQADraftMode(false)
            setSelectedReverseQASessionId(sessionId)
            setReverseQAMessages(updatedMessages)
            setReverseQAQuestion(question)
            setReverseQAInput('')
            persistReverseQASession(uid, sessionId, roleToSend, topic, updatedMessages)
        } catch (err) {
            console.warn('reverseQA send failed', err)
            setReverseQAQuestion('请求失败，请稍后重试')
        } finally {
            setIsReverseQASending(false)
        }
    }

    async function sendEmotionEcho() {
        const trimmed = (emotionInput || '').trim()
        if (!trimmed) return
        if (isEmotionSending) return

        setIsEmotionSending(true)
        setEmotionReply(null)
        setEmotionLabel(null)
        setEmotionSelectedRole(null)
        const roleToSend = role === '自定义' ? (customRole || '未知人物') : role
        const uid = userId || getOrCreateLocalUserId()
        if (!userId) setUserId(uid)

        const clientMessageId = genClientMessageId()
        try {
            const res = await fetch(`${apiBase}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: roleToSend,
                    input: trimmed,
                    userId: uid,
                    mode: 'emotionEcho',
                    clientMessageId
                })
            })
            const data = await res.json()
            setEmotionReply(data.reply || '（无回应）')
            setEmotionLabel(data.emotionLabel || null)
            setEmotionSelectedRole(data.selectedRole || null)

            // Save locally
            const record: EmotionEchoRecord = {
                input: trimmed,
                reply: data.reply || '',
                emotionLabel: data.emotionLabel || '未识别',
                selectedRole: data.selectedRole || roleToSend,
                ts: Date.now()
            }
            saveEmotionEchoTurn(uid, record)
        } catch (err) {
            console.warn('emotionEcho send failed', err)
            setEmotionReply('请求失败，请稍后重试')
        } finally {
            setIsEmotionSending(false)
        }
    }

    useEffect(() => {
        let mounted = true
            ; (async () => {
                try {
                    const res = await fetch(`${apiBase}/roles`)
                    const data = await res.json()
                    if (mounted && data && Array.isArray(data.roles)) {
                        // backend returns array of role objects {id,name,...}
                        const list = data.roles.map((r: any) => (r && (r.name || r.id)) || String(r))
                        if (!list.includes('自定义')) list.push('自定义')
                        setRoles(list)
                        if (!list.includes(role)) setRole(list[0] || '自定义')
                    }
                } catch (err) {
                    // ignore and keep defaults
                    console.warn('failed to fetch roles', err)
                }
            })()
        // init local user id
        const uid = getOrCreateLocalUserId()
        setUserId(uid)

        // on unload/pagehide, notify server to clear server-side history for this user
        const sendEndSession = () => {
            try {
                const payload = JSON.stringify({ userId: uid })
                const blob = new Blob([payload], { type: 'application/json' })
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(`${apiBase}/session/end`, blob)
                } else {
                    // fallback synchronous XHR (may be blocked in some browsers)
                    const xhr = new XMLHttpRequest()
                    xhr.open('POST', `${apiBase}/session/end`, false)
                    xhr.setRequestHeader('Content-Type', 'application/json')
                    try { xhr.send(payload) } catch (e) { /* ignore */ }
                }
            } catch (e) {
                // ignore
            }
        }

        window.addEventListener('beforeunload', sendEndSession)
        window.addEventListener('pagehide', sendEndSession)

        return () => {
            mounted = false
            window.removeEventListener('beforeunload', sendEndSession)
            window.removeEventListener('pagehide', sendEndSession)
        }
    }, [])

    useEffect(() => {
        if (!userId) return
        if (page !== 'history') return
        const roleToShow = selectedHistoryRole || (role === '自定义' ? (customRole || '未知人物') : role)
        refreshHistoryPreservingSelection(userId, roleToShow)
    }, [role, customRole, userId, page, selectedHistoryRole])

    useEffect(() => {
        if (!userId) return
        if (page !== 'reverseQA' && page !== 'reverseQAHistory') return
        if (page === 'reverseQA' && reverseQADraftMode) {
            syncReverseQASessionList(userId)
            return
        }
        refreshReverseQASessions(userId, selectedReverseQASessionId || undefined)
    }, [userId, page, selectedReverseQASessionId, reverseQADraftMode])

    useEffect(() => {
        if (!userId || page !== 'history') return
        if (selectedHistoryRole) return
        const store = loadLocalHistoryStore(userId)
        const firstRole = getSortedHistoryRoles(store)[0]?.name || ''
        if (firstRole) {
            setSelectedHistoryRole(firstRole)
            setHistoryStore(store)
        }
    }, [userId, page, selectedHistoryRole])

    // auto-scroll debate stage to bottom when live messages update or when selecting a debate
    useEffect(() => {
        const el = debateStageRef.current
        if (!el) return
        // allow DOM to render before scrolling inner stage
        const id = window.setTimeout(() => {
            try {
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
            } catch (e) {
                // ignore
            }

            // after inner scroll, ensure outer page scrolls so the bottom of the debate stage is visible
            try {
                window.setTimeout(() => {
                    try {
                        const rect = el.getBoundingClientRect()
                        const bottomOnPage = rect.bottom + window.scrollY
                        const visibleBottom = window.scrollY + window.innerHeight
                        // if bottom of debate stage is below viewport, scroll page down a bit to reveal it
                        if (bottomOnPage > visibleBottom - 8) {
                            const target = Math.max(0, bottomOnPage - window.innerHeight + 16)
                            window.scrollTo({ top: target, behavior: 'smooth' })
                        }
                    } catch (_) { }
                }, 120)
            } catch (_) { }
        }, 50)
        return () => window.clearTimeout(id)
    }, [liveDebate, debatesList, selectedDebateId])

    function renderSidebar() {
        const sections = [
            {
                key: 'chat', label: '对话',
                mainPage: 'chat' as const, historyPage: 'history' as const,
                onMainClick: () => { if (role === '随机') setRole('孔子'); setPage('chat') },
            },
            {
                key: 'debate', label: '辩论',
                mainPage: 'debate' as const, historyPage: 'debateHistory' as const,
                onMainClick: () => {
                    if (role === '随机') setRole('孔子')
                    const uid = userId || getOrCreateLocalUserId()
                    setUserId(uid); refreshDebates(uid); setPage('debate')
                },
            },
            {
                key: 'reverseQA', label: '反向问答',
                mainPage: 'reverseQA' as const, historyPage: 'reverseQAHistory' as const,
                onMainClick: () => { if (role === '随机') setRole('孔子'); openReverseQA() },
            },
            {
                key: 'emotionEcho', label: '情绪回响',
                mainPage: 'emotionEcho' as const, historyPage: 'emotionEchoHistory' as const,
                onMainClick: () => { setRole('随机'); setPage('emotionEcho'); setEmotionReply(null); setEmotionLabel(null); setEmotionSelectedRole(null) },
            },
        ]

        const isSectionActive = (s: typeof sections[number]) =>
            page === s.mainPage || page === s.historyPage

        const handleHistoryNav = (s: typeof sections[number]) => {
            if (s.key === 'chat') {
                const uid = userId || getOrCreateLocalUserId()
                const roleToShow = role === '自定义' ? (customRole || '未知人物') : role
                setUserId(uid); refreshHistory(uid, roleToShow); setPage('history')
            } else if (s.key === 'debate') {
                const uid = userId || getOrCreateLocalUserId()
                setUserId(uid); refreshDebates(uid); setPage('debateHistory')
            } else if (s.key === 'reverseQA') {
                const uid = userId || getOrCreateLocalUserId()
                setUserId(uid); syncReverseQASessionList(uid); setPage('reverseQAHistory')
            } else if (s.key === 'emotionEcho') {
                const uid = userId || getOrCreateLocalUserId()
                setUserId(uid); refreshEmotionEchoHistory(uid); setPage('emotionEchoHistory')
            }
        }

        const closeSidebar = () => setSidebarOpen(false)

        const wrapNav = (action: () => void) => () => {
            action()
            closeSidebar()
        }

        return (
            <>
                <div className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} onClick={closeSidebar} />
                <aside className={`sidebar ${sidebarOpen ? 'visible' : ''}`}>
                    <div className="sidebar-header">
                        <button className="sidebar-close-btn" onClick={closeSidebar} aria-label="关闭菜单">✕</button>
                        <h2 className="sidebar-title">Echoes</h2>
                        <div className="sidebar-subtitle">历史人物对话</div>
                    </div>
                    <nav className="sidebar-nav">
                        {sections.map(s => (
                            <div key={s.key} className={`sidebar-section ${isSectionActive(s) ? 'active' : ''}`}>
                                <button className="sidebar-section-btn" onClick={wrapNav(s.onMainClick)}>
                                    {s.label}
                                    <span className="sidebar-section-arrow">▶</span>
                                </button>
                                <div className="sidebar-sub-items">
                                    <button
                                        className={`sidebar-sub-item ${page === s.mainPage ? 'active' : ''}`}
                                        onClick={wrapNav(s.onMainClick)}
                                    >
                                        主页面
                                    </button>
                                    <button
                                        className={`sidebar-sub-item ${page === s.historyPage ? 'active' : ''}`}
                                        onClick={wrapNav(() => handleHistoryNav(s))}
                                    >
                                        历史
                                    </button>
                                </div>
                            </div>
                        ))}
                    </nav>
                </aside>
            </>
        )
    }

    return (
        <div className="app-layout">
            {renderSidebar()}
            <main className="app-content">
                <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
                    ☰
                </button>
                {page === 'chat' && (
                    <div className="app-shell chat-page">
                        <main className="main-panel">
                            <div className="container">
                                <div className="topbar">
                                    <h1>Echoes — 历史人物对话</h1>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button className="btn secondary" onClick={() => {
                                            const uid = userId || getOrCreateLocalUserId()
                                            const roleToShow = role === '自定义' ? (customRole || '未知人物') : role
                                            setUserId(uid)
                                            refreshHistory(uid, roleToShow)
                                            setPage('history')
                                        }}>查看历史</button>
                                    </div>
                                </div>

                                <div className="controls">
                                    <div className="field role">
                                        <label>人物</label>
                                        <select value={role} onChange={e => setRole(e.target.value)}>
                                            {roles.map(r => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                        {role === '自定义' && (
                                            <input className="custom-role" placeholder="输入自定义人物" value={customRole} onChange={e => setCustomRole(e.target.value)} />
                                        )}
                                    </div>
                                    <div className="field grow question">
                                        <label>问题</label>
                                        <textarea
                                            value={input}
                                            style={{ overflowY: 'auto' }}
                                            onChange={e => setInput(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault()
                                                    const trimmed = (input || '').trim()
                                                    if (trimmed && !isSending) send()
                                                }
                                            }}
                                        />
                                    </div>
                                    <div className="field send">
                                        <label>&nbsp;</label>
                                        <div className="flex">
                                            <button className="btn secondary" onClick={() => setInput('')} disabled={!(input || '').trim()} style={{ marginLeft: 13, marginRight: 8 }}>
                                                清空
                                            </button>
                                            <button className="btn primary" onClick={send} disabled={isSending || !(input || '').trim()}>
                                                {isSending ? '发送中...' : '发送'}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="output">
                                    <h2>回复</h2>
                                    <div className="reply">
                                        {reply ? (
                                            reply
                                                .split(/(?<=[。！？?!;；\.])/u)
                                                .map((s: string) => s.trim())
                                                .filter((s: string) => s.length > 0)
                                                .map((para: string, idx: number) => (
                                                    <p key={idx}>{para}</p>
                                                ))
                                        ) : (
                                            <p className="muted">（暂无回复）</p>
                                        )}
                                    </div>
                                    {evidence && evidence.length > 0 && (
                                        <>
                                            <h3>参考（AI 生成，未经证实）</h3>
                                            <div className="evidence-list">
                                                {evidence.map((ev: any, idx: number) => (
                                                    <button
                                                        key={idx}
                                                        type="button"
                                                        className={`evidence-item ${expandedEvidence.includes(idx) ? 'expanded' : ''}`}
                                                        onClick={() => {
                                                            setExpandedEvidence(prev => (
                                                                prev.includes(idx)
                                                                    ? prev.filter(item => item !== idx)
                                                                    : [...prev, idx]
                                                            ))
                                                        }}
                                                    >
                                                        <div className="evidence-item-header">
                                                            <span>参考 {idx + 1}</span>
                                                            <span className="evidence-item-toggle">
                                                                {expandedEvidence.includes(idx) ? '收起' : '展开'}
                                                            </span>
                                                        </div>
                                                        <div className="evidence-item-body">
                                                            <div className="evidence-text">{ev.text || JSON.stringify(ev)}</div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </main>
                    </div>
                )}

                {page === 'reverseQA' && (
                    <div className="app-shell reverseqa-page">
                        <main className="main-panel">
                            <div className="container reverseqa-container">
                                <div className="topbar reverseqa-topbar">
                                    <div>
                                        <h1>Echoes — 反向问答</h1>
                                        <div className="muted">让历史人物主动向你提问，你来回答，再继续追问</div>
                                    </div>
                                    <div className="reverseqa-topbar-actions">
                                        <button className="btn secondary" onClick={toggleReverseQAHistory}>历史</button>
                                        <button className="btn secondary" onClick={() => reverseQAImportRef.current?.click()}>
                                            导入
                                        </button>
                                        <button className="btn secondary" onClick={startNewReverseQASession}>新会话</button>
                                        <button className="btn secondary" onClick={() => { if (role === '随机') setRole('孔子'); setPage('chat') }}>返回主对话</button>
                                    </div>
                                </div>

                                <input
                                    ref={reverseQAImportRef}
                                    type="file"
                                    accept=".json,.md,.txt,application/json,text/markdown,text/plain"
                                    style={{ display: 'none' }}
                                    onChange={async e => {
                                        const file = e.target.files?.[0]
                                        e.target.value = ''
                                        if (!file) return
                                        try {
                                            await importReverseQAFile(file)
                                        } catch (err) {
                                            console.warn('import reverseQA failed', err)
                                        }
                                    }}
                                />

                                <section className="reverseqa-main-panel">
                                    <div className="reverseqa-current-question">
                                        <div className="muted">当前问题</div>
                                        <div className="reverseqa-question-text">{reverseQAQuestion}</div>
                                    </div>

                                    <div className="reverseqa-thread reply">
                                        {reverseQAMessages.length === 0 ? (
                                            <p className="muted">（点击“生成第一问”开始反向问答）</p>
                                        ) : (
                                            reverseQAMessages.map((message, index) => (
                                                <div key={`${message.ts}-${index}`} className={`reverseqa-message ${message.speaker === '用户' ? 'user' : 'role'}`}>
                                                    <div className="reverseqa-message-meta">{message.speaker} · {new Date(message.ts).toLocaleTimeString()}</div>
                                                    <div className="reverseqa-message-text">{message.text}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <div className="reverseqa-controls">
                                        <div className="field role">
                                            <label>人物</label>
                                            <select value={role} onChange={e => setRole(e.target.value)}>
                                                {roles.map(r => (
                                                    <option key={r} value={r}>{r}</option>
                                                ))}
                                            </select>
                                            {role === '自定义' && (
                                                <input className="custom-role" placeholder="输入自定义人物" value={customRole} onChange={e => setCustomRole(e.target.value)} />
                                            )}
                                        </div>
                                        <div className="field grow question">
                                            <label>{reverseQAMessages.length === 0 ? '话题 / 起点' : '我的回答'}</label>
                                            <textarea
                                                value={reverseQAMessages.length === 0 ? reverseQATopic : reverseQAInput}
                                                style={{ overflowY: 'auto' }}
                                                onChange={e => {
                                                    const value = e.target.value
                                                    if (reverseQAMessages.length === 0) setReverseQATopic(value)
                                                    else setReverseQAInput(value)
                                                }}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault()
                                                        const ready = reverseQAMessages.length === 0
                                                            ? (reverseQATopic || '').trim()
                                                            : (reverseQAInput || '').trim()
                                                        if (ready && !isReverseQASending) sendReverseQA()
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="field send">
                                            <label>&nbsp;</label>
                                            <div className="flex">
                                                <button
                                                    className="btn secondary"
                                                    onClick={() => reverseQAMessages.length === 0 ? setReverseQATopic('') : setReverseQAInput('')}
                                                    disabled={reverseQAMessages.length === 0 ? !(reverseQATopic || '').trim() : !(reverseQAInput || '').trim()}
                                                >
                                                    清空
                                                </button>
                                                <button
                                                    className="btn primary"
                                                    onClick={sendReverseQA}
                                                    disabled={isReverseQASending || (reverseQAMessages.length === 0 ? !(reverseQATopic || '').trim() : !(reverseQAInput || '').trim())}
                                                >
                                                    {isReverseQASending ? '发送中...' : (reverseQAMessages.length === 0 ? '生成第一问' : '提交回答并追问')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </main>
                    </div>
                )}

                {page === 'reverseQAHistory' && (
                    <div className="history-page">
                        <div className="history-page-header">
                            <div>
                                <h1>反向问答历史</h1>
                                <div className="muted">按会话查看本地反向问答记录，并可导出或删除</div>
                            </div>
                            <div className="history-page-actions">
                                <button className="btn secondary" onClick={() => { if (role === '随机') setRole('孔子'); setPage('reverseQA') }}>返回反向问答</button>
                                <button className="btn secondary" onClick={() => reverseQAImportRef.current?.click()}>导入会话</button>
                            </div>
                        </div>

                        <div className="history-page-layout">
                            <aside className="history-sidebar-panel">
                                <div className="history-sidebar-title">反向问答会话</div>
                                <div className="history-sidebar-list history-role-list">
                                    {reverseQASessions.length === 0 ? (
                                        <p className="muted">（暂无反向问答会话）</p>
                                    ) : (
                                        reverseQASessions.map(item => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                className={`history-role ${selectedReverseQASessionId === item.id ? 'active' : ''}`}
                                                onClick={() => setSelectedReverseQASessionId(item.id)}
                                            >
                                                <span className="history-role-name">{item.role}</span>
                                                <span className="history-role-count">{item.messages.length} 条</span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </aside>

                            <section className="history-detail-panel">
                                <div className="history-detail-header history-detail-header-side">
                                    <div>
                                        <div className="muted">用户 ID: {userId}</div>
                                        <h3>{selectedReverseQASessionId || '请选择会话'}</h3>
                                    </div>
                                    <div className="history-toolbar history-toolbar-side">
                                        <label className="history-export-label">
                                            <span>导出格式</span>
                                            <select value={exportFormat} onChange={e => setExportFormat(e.target.value as 'markdown' | 'txt')}>
                                                <option value="markdown">Markdown</option>
                                                <option value="txt">TXT</option>
                                            </select>
                                        </label>
                                        <button
                                            className="btn secondary"
                                            onClick={exportSelectedReverseQASession}
                                            disabled={!selectedReverseQASessionId || !reverseQASessions.find(item => item.id === selectedReverseQASessionId)?.messages.length}
                                        >
                                            导出当前会话
                                        </button>
                                        <button
                                            className="btn secondary danger"
                                            onClick={() => {
                                                if (!userId || !selectedReverseQASessionId) return
                                                deleteLocalReverseQASession(userId, selectedReverseQASessionId)
                                                refreshReverseQASessions(userId)
                                            }}
                                            disabled={!selectedReverseQASessionId}
                                        >
                                            删除当前会话
                                        </button>
                                    </div>
                                </div>

                                <div className="history-thread">
                                    {!selectedReverseQASessionId ? (
                                        <p className="muted">（请选择左侧会话查看历史）</p>
                                    ) : (() => {
                                        const rec = reverseQASessions.find(item => item.id === selectedReverseQASessionId)
                                        if (!rec) return <p className="muted">（该会话已删除）</p>
                                        return rec.messages.length === 0 ? (
                                            <p className="muted">（该会话暂无内容）</p>
                                        ) : rec.messages.map((message, index) => (
                                            <div key={`${message.ts}-${index}`} className={`reverseqa-message ${message.speaker === '用户' ? 'user' : 'role'}`}>
                                                <div className="reverseqa-message-meta">{message.speaker} · {new Date(message.ts).toLocaleString()}</div>
                                                <div className="reverseqa-message-text">{message.text}</div>
                                            </div>
                                        ))
                                    })()}
                                </div>
                            </section>
                        </div>
                    </div>
                )}

                {page === 'emotionEcho' && (
                    <div className="app-shell emotion-echo-page">
                        <main className="main-panel">
                            <div className="container emotion-echo-container">
                                <div className="topbar emotion-echo-topbar">
                                    <div>
                                        <h1>Echoes — 情绪回响</h1>
                                        <div className="muted">倾诉你的心情，让历史人物以他们的智慧回应你</div>
                                    </div>
                                    <div className="reverseqa-topbar-actions">
                                        <button className="btn secondary" onClick={() => {
                                            const uid = userId || getOrCreateLocalUserId()
                                            setUserId(uid)
                                            refreshEmotionEchoHistory(uid)
                                            setPage('emotionEchoHistory')
                                        }}>历史</button>
                                    </div>
                                </div>

                                <section className="emotion-echo-main-panel">
                                    <div className="emotion-echo-input-area">
                                        <div className="field role">
                                            <label>回应人物</label>
                                            <select value={role} onChange={e => setRole(e.target.value)}>
                                                <option value="随机">随机（AI 推荐）</option>
                                                {roles.filter(r => r !== '自定义').map(r => (
                                                    <option key={r} value={r}>{r}</option>
                                                ))}
                                                <option value="自定义">自定义</option>
                                            </select>
                                            {role === '自定义' && (
                                                <input className="custom-role" placeholder="输入自定义人物" value={customRole} onChange={e => setCustomRole(e.target.value)} />
                                            )}
                                        </div>
                                        <div className="field grow">
                                            <label>此刻的心情 / 想说的话</label>
                                            <textarea
                                                value={emotionInput}
                                                style={{ overflowY: 'auto' }}
                                                onChange={e => setEmotionInput(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault()
                                                        const trimmed = (emotionInput || '').trim()
                                                        if (trimmed && !isEmotionSending) sendEmotionEcho()
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="field send">
                                            <label>&nbsp;</label>
                                            <div className="flex">
                                                <button
                                                    className="btn secondary"
                                                    onClick={() => setEmotionInput('')}
                                                    disabled={!(emotionInput || '').trim()}
                                                >
                                                    清空
                                                </button>
                                                <button
                                                    className="btn primary"
                                                    onClick={sendEmotionEcho}
                                                    disabled={isEmotionSending || !(emotionInput || '').trim()}
                                                >
                                                    {isEmotionSending ? '发送中...' : '发送'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="emotion-echo-result">
                                        {emotionLabel && (
                                            <div className="emotion-analysis-badge">检测到情绪：{emotionLabel}</div>
                                        )}
                                        {emotionSelectedRole && role === '随机' && (
                                            <div className="emotion-selected-role">→ {emotionSelectedRole} 回应你</div>
                                        )}
                                        <div className="emotion-echo-reply">
                                            {emotionReply ? (
                                                <div className="emotion-echo-reply-content">
                                                    {emotionReply.split('\n').map((line, i) => (
                                                        line.trim() ? <p key={i}>{line}</p> : <br key={i} />
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="muted">输入你的心情，点击"发送"让历史人物回应你</p>
                                            )}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </main>
                    </div>
                )}

                {page === 'emotionEchoHistory' && (
                    <div className="history-page">
                        <div className="history-page-header">
                            <div>
                                <h1>情绪回响记录</h1>
                                <div className="muted">查看本地情绪回响历史，并可导出或删除</div>
                            </div>
                            <div className="history-page-actions">
                                <button className="btn secondary" onClick={() => setPage('emotionEcho')}>返回情绪回响</button>
                            </div>
                        </div>

                        <div className="history-page-layout">
                            <aside className="history-sidebar-panel">
                                <div className="history-sidebar-title">情绪记录</div>
                                <div className="history-sidebar-list">
                                    <div className="history-role" style={{ cursor: 'default' }}>
                                        <span className="history-role-name">全部记录</span>
                                        <span className="history-role-count">{emotionEchoHistoryStore.length} 条</span>
                                    </div>
                                </div>
                            </aside>

                            <section className="history-detail-panel">
                                <div className="history-detail-header history-detail-header-side">
                                    <div>
                                        <div className="muted">用户 ID: {userId}</div>
                                        <h3>情绪回响 · 全部记录</h3>
                                    </div>
                                    <div className="history-toolbar history-toolbar-side">
                                        <label className="history-export-label">
                                            <span>导出格式</span>
                                            <select value={exportFormat} onChange={e => setExportFormat(e.target.value as 'markdown' | 'txt')}>
                                                <option value="markdown">Markdown</option>
                                                <option value="txt">TXT</option>
                                            </select>
                                        </label>
                                        <button
                                            className="btn secondary"
                                            onClick={() => {
                                                if (!userId || emotionEchoHistoryStore.length === 0) return
                                                const ext = exportFormat === 'markdown' ? 'md' : 'txt'
                                                const content = buildEmotionEchoExport(emotionEchoHistoryStore, exportFormat)
                                                const filename = `echoes-emotion-echo-${new Date().toISOString().slice(0, 10)}.${ext}`
                                                const mime = exportFormat === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
                                                triggerDownload(filename, content, mime)
                                            }}
                                            disabled={emotionEchoHistoryStore.length === 0}
                                        >
                                            导出全部
                                        </button>
                                        <button
                                            className="btn secondary danger"
                                            onClick={() => {
                                                if (!userId) return
                                                clearEmotionEchoHistory(userId)
                                                refreshEmotionEchoHistory(userId)
                                            }}
                                            disabled={emotionEchoHistoryStore.length === 0}
                                        >
                                            清除全部
                                        </button>
                                    </div>
                                </div>

                                <div className="history-thread">
                                    {emotionEchoHistoryStore.length === 0 ? (
                                        <p className="muted">（暂无情绪回响记录）</p>
                                    ) : (
                                        emotionEchoHistoryStore.slice().reverse().map((r, displayIndex) => {
                                            const realIndex = emotionEchoHistoryStore.length - 1 - displayIndex
                                            return (
                                                <div key={`${r.ts}-${displayIndex}`} className="history-item">
                                                    <div className="history-item-head">
                                                        <div className="meta">{new Date(r.ts).toLocaleString()} · 情绪：{r.emotionLabel}</div>
                                                        <button className="history-item-delete" onClick={() => {
                                                            if (!userId) return
                                                            deleteEmotionEchoTurn(userId, realIndex)
                                                            refreshEmotionEchoHistory(userId)
                                                        }}>删除</button>
                                                    </div>
                                                    <div className="emotion-echo-history-meta">回应人物：{r.selectedRole}</div>
                                                    <div><strong>用户：</strong> {r.input}</div>
                                                    <div className="mt-2"><strong>回应：</strong> {r.reply}</div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>
                )}

                {page === 'history' && (
                    <div className="history-page">
                        <div className="history-page-header">
                            <div>
                                <h1>历史记录</h1>
                                <div className="muted">按人物浏览本地对话，并可导出或删除</div>
                            </div>
                            <div className="history-page-actions">
                                <button className="btn secondary" onClick={() => { if (role === '随机') setRole('孔子'); setPage('chat') }}>返回主对话</button>
                            </div>
                        </div>

                        <div className="history-page-layout">
                            <aside className="history-sidebar-panel">
                                <div className="history-sidebar-title">人物</div>
                                <div className="history-sidebar-list history-role-list">
                                    {getSortedHistoryRoles(historyStore).length === 0 ? (
                                        <p className="muted">（暂无历史人物）</p>
                                    ) : (
                                        getSortedHistoryRoles(historyStore).map(item => (
                                            <button
                                                key={item.name}
                                                type="button"
                                                className={`history-role ${selectedHistoryRole === item.name ? 'active' : ''}`}
                                                onClick={() => setSelectedHistoryRole(item.name)}
                                            >
                                                <span className="history-role-name">{item.name}</span>
                                                <span className="history-role-count">{item.turns.length} 轮</span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </aside>

                            <section className="history-detail-panel">
                                <div className="history-detail-header history-detail-header-side">
                                    <div>
                                        <div className="muted">用户 ID: {userId}</div>
                                        <h3>{selectedHistoryRole || '请选择人物'}</h3>
                                    </div>
                                    <div className="history-toolbar history-toolbar-side">
                                        <label className="history-export-label">
                                            <span>导出格式</span>
                                            <select value={exportFormat} onChange={e => setExportFormat(e.target.value as 'markdown' | 'txt')}>
                                                <option value="markdown">Markdown</option>
                                                <option value="txt">TXT</option>
                                            </select>
                                        </label>
                                        <button
                                            className="btn secondary"
                                            onClick={exportSelectedHistory}
                                            disabled={!selectedHistoryRole || !historyStore[selectedHistoryRole]?.length}
                                        >
                                            下载当前人物
                                        </button>
                                        <button
                                            className="btn secondary danger"
                                            onClick={clearSelectedRoleHistory}
                                            disabled={!selectedHistoryRole || !historyStore[selectedHistoryRole]?.length}
                                        >
                                            清除当前人物
                                        </button>
                                    </div>
                                </div>

                                <div className="history-thread">
                                    {!selectedHistoryRole ? (
                                        <p className="muted">（请选择左侧人物查看历史）</p>
                                    ) : (historyStore[selectedHistoryRole] || []).length === 0 ? (
                                        <p className="muted">（该人物暂无历史）</p>
                                    ) : (
                                        (historyStore[selectedHistoryRole] || []).slice().reverse().map((t, i) => {
                                            const originalIndex = (historyStore[selectedHistoryRole] || []).length - 1 - i
                                            return (
                                                <div key={`${t.ts}-${i}`} className="history-item">
                                                    <div className="history-item-head">
                                                        <div className="meta">{new Date(t.ts).toLocaleString()}</div>
                                                        <button className="history-item-delete" onClick={() => removeSelectedRoleTurn(originalIndex)}>删除</button>
                                                    </div>
                                                    <div><strong>用户：</strong> {t.user}</div>
                                                    <div className="mt-2"><strong>助手：</strong> {t.assistant}</div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>
                )}

                {page === 'debate' && (
                    <div className="history-page">
                        <div className="history-page-header">
                            <div>
                                <h1>人物辩论</h1>
                                <div className="muted">选择或输入最多 3 人，系统生成 3 轮辩论并可本地保存</div>
                            </div>
                            <div className="history-page-actions">
                                <button className="btn secondary" onClick={() => { if (role === '随机') setRole('孔子'); setPage('chat') }}>返回主对话</button>
                                <button className="btn secondary" onClick={openDebateHistory}>查看辩论历史</button>
                            </div>
                        </div>

                        <div className="history-detail-panel">
                            <div className="debate-page-body">
                                <div className="debate-topic-block">
                                    <label>辩题</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                                        <input ref={debateTopicRef} className="debate-topic-input" value={debateTopic} onChange={e => setDebateTopic(e.target.value)} />
                                        <button
                                            type="button"
                                            className="btn secondary topic-clear-btn"
                                            onClick={() => setDebateTopic('')}
                                            aria-label="清空辩题"
                                        >
                                            清空
                                        </button>
                                    </div>
                                </div>
                                <div className="debate-participants-block">
                                    <label>人物（最多 3 个）</label>
                                    <div className="debate-participants-row">
                                        {[0, 1, 2].map(i => (
                                            <div key={i} className="debate-slot-card">
                                                <button
                                                    type="button"
                                                    className={`debate-slot-tab ${debateActiveSlot === i ? 'active' : ''}`}
                                                    onClick={() => setDebateActiveSlot(i)}
                                                >
                                                    第 {i + 1} 位
                                                    <span className="debate-slot-tab-value">{debateParticipants[i] || '（空）'}</span>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="debate-editor-row">
                                    <div className="debate-editor-label">正在编辑第 {debateActiveSlot + 1} 位</div>
                                    <input
                                        ref={debateCustomRef}
                                        className="debate-custom-input"
                                        placeholder={`输入第 ${debateActiveSlot + 1} 位人物`}
                                        value={debateParticipants[debateActiveSlot] || ''}
                                        onChange={e => {
                                            const next = debateParticipants.slice()
                                            while (next.length < 3) next.push('')
                                            next[debateActiveSlot] = e.target.value
                                            setDebateParticipants(next)
                                        }}
                                    />
                                    <select
                                        className="debate-quick-select"
                                        value={getDebateQuickSelectValue(debateParticipants[debateActiveSlot] || '')}
                                        onChange={e => {
                                            const v = e.target.value
                                            const next = debateParticipants.slice()
                                            while (next.length < 3) next.push('')
                                            // selecting empty should always clear the current slot, including custom text
                                            if (!v) {
                                                next[debateActiveSlot] = ''
                                                setDebateParticipants(next)
                                                try { debateCustomRef.current?.focus() } catch (_) { }
                                                return
                                            }
                                            // prevent selecting a name that's already chosen in another slot
                                            const already = next.find((val, idx) => idx !== debateActiveSlot && (val || '') === v)
                                            if (already) {
                                                alert('该人物已在其他位置被选择，请先清除或选择其他人物')
                                                return
                                            }
                                            next[debateActiveSlot] = v
                                            setDebateParticipants(next)
                                        }}
                                    >
                                        <option value="">（空）</option>
                                        <option value={debateQuickSelectCustomValue} hidden disabled>（自定义）</option>
                                        {debateFixedRoles.map(name => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                    <button className="btn primary" style={{ marginLeft: 0 }} onClick={async () => {
                                        const uid = userId || getOrCreateLocalUserId()
                                        setUserId(uid)
                                        // validate debate topic
                                        if (!debateTopic || debateTopic.trim().length === 0) {
                                            alert('请先输入辩题')
                                            try { debateTopicRef.current?.focus() } catch (_) { }
                                            return
                                        }

                                        const participantsToUse = debateParticipants.map(v => (v || '').trim()).filter(s => s.length > 0)
                                        if (participantsToUse.length === 0) return alert('请先选择至少一个人物')
                                        // dedupe check
                                        const uniq = new Set(participantsToUse)
                                        if (uniq.size !== participantsToUse.length) {
                                            alert('人物不能相同，请确保每位参与者不同')
                                            return
                                        }
                                        setReply(null)
                                        // robustly scroll the outer page so the user sees the live stage
                                        const scrollToDebateArea = () => {
                                            const el = debateStageRef.current
                                            if (!el) return
                                            try {
                                                const rect = el.getBoundingClientRect()
                                                const top = rect.top + window.scrollY - 24 // offset for header
                                                window.scrollTo({ top, behavior: 'smooth' })
                                            } catch (e) {
                                                try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (_) { }
                                            }
                                        }
                                        // allow a short delay for layout then scroll
                                        try { setTimeout(scrollToDebateArea, 80) } catch (_) { scrollToDebateArea() }
                                        await runDebate(uid, debateTopic, participantsToUse)
                                    }} disabled={isDebating}>{isDebating ? '进行中…' : '开始辩论'}</button>
                                    {isDebating && (
                                        <button
                                            type="button"
                                            className="btn secondary danger"
                                            style={{ marginLeft: 8 }}
                                            onClick={() => {
                                                stopRequestedRef.current = true
                                                try { debateAbortRef.current?.abort() } catch (_) { }
                                                debateAbortRef.current = null
                                                setIsDebating(false)
                                                // leave liveDebate so user can see collected messages, but stop further generation
                                            }}
                                        >停止辩论</button>
                                    )}
                                </div>

                                <div style={{ marginTop: 12 }}>
                                    <h3>实时辩论</h3>
                                    <div className="debate-stage" ref={debateStageRef}>
                                        {selectedDebateId ? (
                                            liveDebate && liveDebate.id === selectedDebateId
                                                ? liveDebate.messages.map((m, idx) => (
                                                    <div key={idx} className={`debate-bubble ${idx % 2 === 0 ? 'left' : 'right'}`}>
                                                        <div className="debate-meta">{m.speaker} · {new Date(m.ts).toLocaleTimeString()}</div>
                                                        <div className="debate-text">{m.text}</div>
                                                    </div>
                                                ))
                                                : renderSelectedDebate()
                                        ) : (
                                            <p className="muted">（开始辩论后，这里会实时显示每个气泡）</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {page === 'debateHistory' && (
                    <div className="history-page">
                        <div className="history-page-header">
                            <div>
                                <h1>辩论历史</h1>
                                <div className="muted">按辩题查看本地辩论记录，并可导出或删除</div>
                            </div>
                            <div className="history-page-actions">
                                <button className="btn secondary" onClick={() => setPage('debate')}>返回人物辩论</button>
                            </div>
                        </div>

                        <div className="history-page-layout">
                            <aside className="history-sidebar-panel">
                                <div className="history-sidebar-title">辩论记录</div>
                                <div className="history-sidebar-list history-role-list">
                                    {debatesList.length === 0 ? (
                                        <p className="muted">（暂无本地辩论）</p>
                                    ) : (
                                        debatesList.map(item => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                className={`history-role ${selectedDebateId === item.id ? 'active' : ''}`}
                                                onClick={() => setSelectedDebateId(item.id)}
                                            >
                                                <span className="history-role-name">{item.topic}</span>
                                                <span className="history-role-count">{item.messages.length} 条</span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </aside>

                            <section className="history-detail-panel">
                                <div className="history-detail-header history-detail-header-side">
                                    <div>
                                        <div className="muted">用户 ID: {userId}</div>
                                        <h3>{selectedDebateId || '请选择辩论'}</h3>
                                    </div>
                                    <div className="history-toolbar history-toolbar-side">
                                        <label className="history-export-label">
                                            <span>导出格式</span>
                                            <select value={exportFormat} onChange={e => setExportFormat(e.target.value as 'markdown' | 'txt')}>
                                                <option value="markdown">Markdown</option>
                                                <option value="txt">TXT</option>
                                            </select>
                                        </label>
                                        <button
                                            className="btn secondary"
                                            onClick={exportSelectedDebate}
                                            disabled={!selectedDebateId || !debatesList.find(d => d.id === selectedDebateId)?.messages.length}
                                        >
                                            导出当前辩论
                                        </button>
                                        <button
                                            className="btn secondary danger"
                                            onClick={() => {
                                                if (!userId || !selectedDebateId) return
                                                deleteLocalDebate(userId, selectedDebateId)
                                                refreshDebates(userId)
                                            }}
                                            disabled={!selectedDebateId}
                                        >
                                            删除当前辩论
                                        </button>
                                    </div>
                                </div>

                                <div className="history-thread">
                                    {!selectedDebateId ? (
                                        <p className="muted">（请选择左侧辩论查看历史）</p>
                                    ) : (() => {
                                        const rec = debatesList.find(d => d.id === selectedDebateId)
                                        if (!rec) return <p className="muted">（该辩论已删除）</p>
                                        return rec.messages.length === 0 ? (
                                            <p className="muted">（该辩论暂无内容）</p>
                                        ) : rec.messages.map((m, idx) => (
                                            <div key={`${m.ts}-${idx}`} className={`debate-bubble ${idx % 2 === 0 ? 'left' : 'right'}`}>
                                                <div className="debate-meta">{m.speaker} · {new Date(m.ts).toLocaleString()}</div>
                                                <div className="debate-text">{m.text}</div>
                                            </div>
                                        ))
                                    })()}
                                </div>
                            </section>
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
