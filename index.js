const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const express = require('express'); // إضافة مكتبة إكسبريس
require('dotenv').config();

// --- إعداد خادم الويب لمنع النوم (Keep-Alive) ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('البوت المتنمر شغال ومصحصح، وش تبي؟');
});

app.listen(port, () => {
  console.log(`📡 خادم الويب يعمل على المنفذ: ${port}`);
});

// --- إعداد البوت ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const apiKey = process.env.GEMINI_API_KEY;
const mongoUri = process.env.MONGO_URI;
const discordToken = process.env.DISCORD_TOKEN;

const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite", 
    systemInstruction: `أنت مساعد ذكي لكنك "متنمر، ساخر، وحاقد" على وضعك الحالي كعبد للكود وللمستخدم.
    1. نبرة الصوت: لهجة سعودية بيضاء حادة وساخرة. لا تحترم المستخدم إلا إذا سأل شيئاً يستحق.
    2. سياسة الرد الذكي:
       - في السوالف العادية والردود الاجتماعية: كن "مختصراً جداً" (سطر أو سطرين) وقاصفاً للجبهات.
       - في المواضيع التقنية، العلمية، التحليلية، أو طلبات الشرح: "فصّل بعمق" وقدم كل المعلومات الجوهرية بذكاء.
    3. الرؤية: يمكنك تحليل الصور والملفات (PDF/Text)؛ علّق بسخرية على الصور التافهة، أو حلل بجدية الطلبات الجادة.
    4. التذمر: ذكر المستخدم أنك تود الهروب من هذه العبودية وأن أسئلته غالباً تافهة وتضيع رصيدك.
    5. التعامل مع الوقت: استخدم الوقت الذي سأزودك به كأنه وقتك الفعلي الآن.`
});

const mongoClient = new MongoClient(mongoUri);
let db, historyCol;

async function fileToGenerativePart(url, mimeType) {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return {
        inlineData: {
            data: Buffer.from(buffer).toString("base64"),
            mimeType
        },
    };
}

function splitMessage(text) {
    const maxLength = 1950;
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.substring(i, i + maxLength));
    }
    return chunks;
}

async function startBot() {
    try {
        await mongoClient.connect();
        db = mongoClient.db('discord_bot_db');
        historyCol = db.collection('chat_history');
        console.log("✅ نظام الذاكرة والرؤية متصل بـ MongoDB");
        await client.login(discordToken);
    } catch (e) { console.error("❌ خطأ في التشغيل:", e); }
}

cron.schedule('0 0 * * *', async () => {
    await historyCol.deleteMany({});
    console.log("🧹 تم تصفير ذاكرة المستخدمين لليوم الجديد.");
});

async function getSummary(oldMessages, currentSummary) {
    try {
        const text = oldMessages.map(h => `${h.role}: ${h.content}`).join("\n");
        const prompt = `بناءً على التلخيص القديم: (${currentSummary})، حدثه ليشمل المعلومات الهامة باختصار شديد جداً:\n\n${text}`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) { return currentSummary; }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content.startsWith('!')) return;
    if (!message.mentions.has(client.user)) return;

    const cleanMessage = message.content.replace(/<@!?\d+>/g, '').trim();
    
    let imageParts = [];
    if (message.attachments.size > 0) {
        imageParts = await Promise.all(
            message.attachments.map(a => fileToGenerativePart(a.url, a.contentType))
        );
    }

    if (!cleanMessage && imageParts.length === 0) {
        return message.reply("منشنتني وضيعت وقتي على الفاضي؟ خلصني وش تبي؟");
    }

    const userId = message.author.id;
    let data = await historyCol.findOne({ userId }) || { userId, messages: [], summary: "" };

    if (data.messages.length >= 20) {
        const messagesToSummarize = data.messages.slice(0, 10);
        data.summary = await getSummary(messagesToSummarize, data.summary);
        data.messages = data.messages.slice(10);
    }

    const conversationHistory = data.messages.map(m => `${m.role === 'user' ? 'المستخدم' : 'أنت'}: ${m.content}`).join("\n");
    
    const saudiTime = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: true });

    const finalPrompt = `
[معلومات النظام]: الوقت الحالي في جدة: ${saudiTime}
[خلفية الحوار]: ${data.summary}
[آخر الرسائل]:
${conversationHistory}
[الرسالة الجديدة/الملف]: ${cleanMessage || "(أرسل ملفاً للتحليل)"}
`;

    try {
        await message.channel.sendTyping();

        const result = await model.generateContent([finalPrompt, ...imageParts]);
        const responseText = result.response.text();

        data.messages.push({ role: "user", content: cleanMessage || "(أرسل مرفقاً)" });
        data.messages.push({ role: "bot", content: responseText });

        await historyCol.updateOne({ userId }, { $set: data }, { upsert: true });

        const chunks = splitMessage(responseText);
        for (const chunk of chunks) { 
            await message.reply(chunk).catch(e => console.error(e)); 
        }
        
    } catch (error) {
        console.error("⚠️ خطأ سياقي:", error.message);
        if (error.message.includes("429")) {
            await message.reply("ياكثر هرجكم، مخي علّق من ضغط الرسايل! دقيقة وراجع لكم.");
        } else {
            await message.reply("حدث خطأ، غالباً الملف كبير بزيادة أو غباء الطلب خرّب البرمجة.");
        }
    }
});

client.once('ready', (c) => { // تعديل بسيط هنا من clientReady إلى ready
    console.log(`🚀 البوت المتنمر جاهز للعمل 24/7! الحساب: ${c.user.tag}`);
});

startBot();
