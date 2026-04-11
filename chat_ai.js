// chat_ai.js
const { EmbedBuilder } = require('discord.js');

module.exports = async function handleChat(msg, client, chatModel, chatModelSearch, dailySearchCount, SEARCH_LIMIT, historyCol) {
    const exactMessage = msg.content.trim();
    const startsWithBot = exactMessage.toLowerCase().startsWith("حمودي") || exactMessage.toLowerCase().startsWith("مودي");
    const mentioned = msg.mentions.has(client.user);

    if (!startsWithBot && !mentioned) return false;

    let cleanMessage = exactMessage.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    if (cleanMessage.startsWith("حمودي")) cleanMessage = cleanMessage.replace(/^حمودي/, "").trim();
    if (cleanMessage.startsWith("مودي")) cleanMessage = cleanMessage.replace(/^مودي/, "").trim();

    const userId = msg.author.id;
    const chatHistory = await getUserContext(userId, historyCol);
    const saudiTime = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });

    // ==========================================
    // 🔥 التعديل الجديد: سحب سياق التدخل (الريبلاي)
    // ==========================================
    let extraContext = "";
    if (msg.reference && msg.reference.messageId) {
        try {
            // نجيب الرسالة اللي رد عليها
            const repliedMsg = await msg.channel.messages.fetch(msg.reference.messageId);
            
            // هل الرسالة اللي رد عليها حقت البوت؟
            if (repliedMsg.author.id === client.user.id) {
                let otherUserId = null;
                let otherUserName = "شخص آخر";

                // نحاول نعرف البوت كان يكلم مين في رسالته
                if (repliedMsg.reference && repliedMsg.reference.messageId) {
                    const origMsg = await msg.channel.messages.fetch(repliedMsg.reference.messageId);
                    otherUserId = origMsg.author.id;
                    otherUserName = origMsg.author.username;
                } else if (repliedMsg.mentions.repliedUser) {
                    otherUserId = repliedMsg.mentions.repliedUser.id;
                    otherUserName = repliedMsg.mentions.repliedUser.username;
                }

                // إذا البوت كان يكلم شخص "غير" اللي سوى ريبلاي الحين
                if (otherUserId && otherUserId !== msg.author.id) {
                    // نسحب آخر 4 رسائل لهذا الشخص من قاعدة البيانات
                    const otherUserHistory = await historyCol.find({ userId: otherUserId }).sort({ timestamp: -1 }).limit(4).toArray();
                    
                    if (otherUserHistory.length > 0) {
                        otherUserHistory.reverse(); // نرتبها من الأقدم للأحدث
                        extraContext = `\n[تنبيه مهم جداً: المستخدم الحالي (${msg.author.username}) يتدخل ويرد على رسالتك التي كنت توجهها لشخص آخر اسمه (${otherUserName}).\nهذا هو سياق الحوار الأخير بينك وبين (${otherUserName}) عشان تفهم السالفة:\n`;
                        
                        otherUserHistory.forEach(h => {
                            const speaker = h.role === 'model' ? 'أنت (البوت)' : `الطرف الآخر (${otherUserName})`;
                            extraContext += `- ${speaker}: ${h.content}\n`;
                        });
                        
                        extraContext += `]\nبناءً على هذا السياق، افهم مقصد المستخدم الحالي (${msg.author.username}) ورد عليه بذكاء.\n`;
                    }
                } 
                // لو كان راد على رسالة البوت الموجهة له هو نفسه
                else if (otherUserId === msg.author.id || !otherUserId) {
                     extraContext = `\n[ملاحظة: المستخدم يرد تحديداً على رسالتك هذه: "${repliedMsg.content}"]\n`;
                }
            }
        } catch (e) {
            console.error("Context fetch error:", e);
        }
    }

    // دمج السياق مع الرسالة
    const finalPrompt = `[الوقت]\n${saudiTime}\n${extraContext}\n[رسالة المستخدم]\n${cleanMessage}`;

    await msg.channel.sendTyping();
    const parts = [{ text: finalPrompt }];

    for (const att of msg.attachments.values()) {
        const res = await fetch(att.url);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 20 * 1024 * 1024) continue;
        const mime = att.contentType || "application/octet-stream";

        if (mime.startsWith("image")) {
            parts.push({ inlineData: { mimeType: mime, data: buffer.toString("base64") } });
        } else if (mime === "application/pdf") {
            parts.push({ inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } });
        } else if (mime.includes("text") || mime.includes("json") || mime.includes("javascript")) {
            const text = buffer.toString("utf8").substring(0, 20000);
            parts.push({ text: `[محتوى ملف]\n${text}` });
        }
    }

    let activeModel = chatModel;
    if (dailySearchCount < SEARCH_LIMIT) {
        activeModel = chatModelSearch;
        // ملاحظة: العداد بيزيد في الانديكس
    }

    try {
        const chat = activeModel.startChat({ history: chatHistory });
        const result = await chat.sendMessage(parts);
        let responseText = result.response.text() || "لم أفهم الطلب.";

        if (responseText.includes("[الرد النهائي]")) {
            responseText = responseText.split("[الرد النهائي]")[1].trim().replace(/^["']|["']$/g, '');
        }
        responseText = responseText.replace(/\[السياق الداخلي\][\s\S]*?\[الرد المقترح\][\s\S]*?/gi, '').trim();

        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            const polls = JSON.parse(jsonMatch[1]);
            for (const pollData of polls) {
                await msg.channel.send({
                    poll: {
                        question: { text: pollData.question },
                        answers: pollData.options.map(o => ({ text: o })),
                        duration: 24
                    }
                });
            }
            return true;
        }

        await saveMessage(userId, 'user', cleanMessage, historyCol);
        await saveMessage(userId, 'model', responseText, historyCol);

        const chunks = splitMessage(responseText);
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) await msg.reply(chunks[i]).catch(console.error);
            else await msg.channel.send(chunks[i]).catch(console.error);
        }
        return true;
    } catch (e) {
        console.error("Chat Error:", e);
        return false;
    }
}

// أدوات مساعدة خاصة بالشات
async function getUserContext(userId, historyCol) {
    if (!historyCol) return [];
    const messages = await historyCol.find({ userId }).sort({ timestamp: 1 }).toArray();
    if (messages.length === 0) return [];
    const lastMessage = messages[messages.length - 1];
    if ((new Date() - new Date(lastMessage.timestamp)) / (1000 * 60) > 15) {
        await historyCol.deleteMany({ userId });
        return [];
    }
    return messages.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
}

async function saveMessage(userId, role, content, historyCol) {
    if (!historyCol) return;
    const now = new Date();
    await historyCol.insertOne({ userId, role, content, timestamp: now, expireAt: new Date(now.getTime() + 60 * 60 * 1000) });
}

function splitMessage(text) {
    const max = 1950;
    const chunks = [];
    for (let i = 0; i < text.length; i += max) chunks.push(text.substring(i, i + max));
    return chunks;
}