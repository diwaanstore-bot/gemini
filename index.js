const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const express = require('express'); // أضفنا الإكسبريس هنا
require('dotenv').config();

// --- إعداد الويب سيرفس (Keep-alive) ---
const app = express();
app.get('/', (req, res) => res.send('حمودي حي يرزق ويعمل بنجاح! 🚀'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Web Service Started'));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// --- إعدادات البيئة ---

const apiKey = process.env.GEMINI_API_KEY;
const mongoUri = process.env.MONGO_URI;
const discordToken = process.env.DISCORD_TOKEN;
const genAI = new GoogleGenerativeAI(apiKey);

// قائمة الأعضاء والأساليب الخاصة
const specialUsers = {
    "545613574874071063": { names: ["لافندر", "الجاسوسة", "الحربية", "السوسة", "توثلس", "ميلينا", "لافي", "نيراي", "ريماس"], style: "رسمي يميل للمغازلة والحنية." },
    "532264405476573224": { names: ["نايل", "كمون", "نيولي", "كونان", "الملك الذي لطالما كان", "الدكتور", "ناكسل"], style: "تعظيم وتبجيل فائق، أنت خادمه المطاع." },
    "1106288355228004372": { names: ["شكشوكه", "ساسوكي", "ميلودي", "الحضرمي"], style: "رسمي مع تذمر وتنمر بسيط ولطف في النهاية." },
    "1270057947334185053": { names: ["ايفا", "العبدة", "سويدة", "الخدامة", "المراهق", "القاصر"], style: "تنمر وقمع ومعاندة شديدة جداً." }
};

const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite", 
    systemInstruction: `أنت مساعد ذكي، مهني، ومباشر.
    1. أسلوب الرد: تحدث بشكل طبيعي.
    2. ميزة التصويت (Polls): إذا طلب المستخدم إنشاء أسئلة خيارات أو تصويت، رد بـ JSON فقط داخل \`\`\`json كالتالي:
       [{"question": "السؤال", "options": ["خيار1", "خيار2"]}]
    3. إذا كان الطلب دردشة، التزم بأسلوب العضو المخصص ونوع في المناداة بالأسماء المتاحة له.`
});

const mongoClient = new MongoClient(mongoUri);
let db, historyCol;

// دالة تقسيم الرسائل
function splitMessage(text) {
    const maxLength = 1950;
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) { chunks.push(text.substring(i, i + maxLength)); }
    return chunks;
}

async function startBot() {
    try {
        await mongoClient.connect();
        db = mongoClient.db('discord_bot_db');
        historyCol = db.collection('chat_history');
        await client.login(discordToken);
        console.log("✅ البوت شغال، الويب سيرفس فعال، ونظام التصويت جاهز");
    } catch (e) { console.error("❌ خطأ التشغيل:", e); }
}

cron.schedule('0 0 * * *', async () => { await historyCol.deleteMany({}); });

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content.startsWith('!')) return;

    const startsWithNickname = message.content.trim().startsWith('حمودي');
    const isMentioned = message.mentions.has(client.user);
    if (!startsWithNickname && !isMentioned) return;

    let cleanMessage = message.content.replace(/<@!?\d+>/g, '').trim();
    if (cleanMessage.startsWith('حمودي')) cleanMessage = cleanMessage.replace(/^حمودي/, '').trim();

    const userId = message.author.id;
    let data = await historyCol.findOne({ userId }) || { userId, messages: [], summary: "" };

    let userSpecialInstruction = specialUsers[userId] ? `[أسلوب العضو]: ${specialUsers[userId].style} الأسماء المتاحة: (${specialUsers[userId].names.join(", ")})` : "";
    const saudiTime = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });

    const finalPrompt = `[الوقت]: ${saudiTime}\n${userSpecialInstruction}\n[الخلفية]: ${data.summary}\n[الطلب]: ${cleanMessage}`;

    try {
        await message.channel.sendTyping();
        const result = await model.generateContent(finalPrompt);
        const responseText = result.response.text();

        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            try {
                const polls = JSON.parse(jsonMatch[1]);
                for (const pollData of polls) {
                    await message.channel.send({
                        poll: {
                            question: { text: pollData.question },
                            answers: pollData.options.slice(0, 10).map(opt => ({ text: opt })),
                            duration: 24
                        }
                    });
                }
                return;
            } catch (e) { console.error("JSON Error:", e); }
        }

        data.messages.push({ role: "user", content: cleanMessage });
        data.messages.push({ role: "bot", content: responseText });
        await historyCol.updateOne({ userId }, { $set: data }, { upsert: true });

        const chunks = splitMessage(responseText);
        for (const chunk of chunks) { await message.reply(chunk); }

    } catch (error) {
        console.error("⚠️ Error:", error);
        await message.reply("حصل خطأ بسيط، جرب تسألني مرة ثانية.");
    }
});

startBot();
