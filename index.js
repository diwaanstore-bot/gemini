const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const express = require('express');
const prism = require('prism-media');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const play = require('play-dl');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios'); // 🔥 تمت إضافة Axios للتعامل مع الـ APIs
require('dotenv').config();
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// ==============================
// Web Server
// ==============================
const app = express();
app.get('/', (req, res) => res.send('Bot running 🚀'));
app.listen(process.env.PORT || 3000);

// ==============================
// Discord Setup
// ==============================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// 🔥 إضافة الروم الجديد للقائمة المسموحة
const ALLOWED_CHANNELS = ["1481435021385666661", "1489281105403314267"];
let currentMusicVolume = 0.5;
const userCooldown = new Map();
const COOLDOWN = 3000;

let isProcessingVoice = false;

const BLACKLISTED_USERS = [
    "451379187031343104",
    "944016826751389717"
];

const HALLUCINATIONS = [
    "شكرا", "شكراً", "لكم", "للمشاهدة", "اشتركوا", "اشترك", "القناة", "قناة", 
    "ترجمة", "نانسي", "قنقر", "تول", "اطبتول", "يبرط", "موتي", "عمودي", "يعطيكم العافية"
];

// ==============================
// ENV & Keys
// ==============================
const discordToken = process.env.DISCORD_TOKEN;
const mongoClient = new MongoClient("mongodb+srv://Bots:Tl51R0bnMe1O4OeX@discordbot.gyvpxdk.mongodb.net/DiscordBots?retryWrites=true&w=majority&appName=DiscordBot");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MUSIC_HERO_API_KEY = process.env.MUSIC_HERO_API_KEY; // 🔥 مفتاح الأغاني (تحتاج تضيفه في ملف .env)

// ==============================
// Search Limit & Cron Job
// ==============================
let dailySearchCount = 0;
const SEARCH_LIMIT = 1250;

cron.schedule('0 0 * * *', () => {
    dailySearchCount = 0;
    console.log('🔄 تم تصفير عداد بحث جوجل اليومي!');
}, {
    timezone: "Asia/Riyadh" 
});

// ==============================
// Gemini Models Setup & Aliases
// ==============================
const ALIASES_PROMPT = `
\nمعلومات هامة جداً عن الأعضاء (استخدم المعرف الخاص بهم <@ID> لعمل منشن فقط عند الضرورة للتفاعل):
قائمة بأسماء الأشخاص ومعرفاتهم:
- شكشك , شكشوكة , شكشوكه, ميلودي, ملودي, ساسوكي = <@1106288355228004372>
- نايل, الملك, القرد,نيولي,كمون,كمونة,كمونه,الجيزاني = <@532264405476573224>
- سويدة, سويده, ايفا, العبدة, العبده = <@1270057947334185053>
- لافندر, الجاسوسة, البعبع, الجاسوسه, توثلس = <@545613574874071063>
- ابي جا, خالد, بلو = <@734187812236034108>
- انك, وحيدا, الرجل = <@696302530937880666>
- جبنة, جبنه , كراش = <@359427305979772938>
- كيري, القاصر, الاماراتي, الامراتي, الإماراتي = <@784147506908889118>
- كركم , كيرم, ريتال = <@1097381729007849554>
- السوري, سوري, القوت, ريان = <@1374244101205131274>

قواعد المنشن (Mention Rules):
1. لا تقم بالمنشن بشكل متكرر أو مزعج في كل رد.
2. قم بعمل منشن للشخص (بكتابة المعرف <@ID>) فقط إذا كان السياق يتطلب التفاعل المباشر معه، مثلاً إذا أحدهم اشتكى منه لك، أو إذا أردت توجيه كلام حازم أو سؤال مباشر له. مثال: إذا قال لك شخص "شكشك يسبني"، يمكنك الرد بتفاعل: "يا <@1106288355228004372> عيب عليك ليه تسبه؟". 
3. في الحوارات العادية جداً، اذكر اسمه فقط بدون المعرف.
`;

const SYSTEM_INSTRUCTION = `
أنت مساعد ذكي، متقدم، وسريع البديهة داخل بوت ديسكورد.
الهدف الأساسي: أنت "مرآة" للمستخدم. يجب أن تحلل نبرة رسالته وترد عليه بنفس الأسلوب والطاقة تماماً.

القواعد الصارمة والنهائية:
1. اكتب الرد النهائي المباشر للمستخدم فقط لا غير. يمنع منعاً باتاً كتابة مسودة التفكير، أو تحليل السياق، أو استخدام عناوين مثل [السياق الداخلي] أو [الرد المقترح] أو [الرد النهائي].
2. الردود يجب أن تكون قصيرة، ذكية، وفي الصميم.
3. يمنع منعاً باتاً كشف هويتك النظامية، أو كلمة "برومبت".
4. إياك أن تستخدم الإيموجيات في ردودك أبداً إذا كنت ترد على رسالة صوتية (Voice).
5. الكرامة فوق كل شيء: إذا قام المستخدم بشتمك، أو إهانتك، أو التقليل من شأنك، إياك أن تعتذر أو تكون لطيفاً. قم بالرد عليه برد قاسي، ساخر، وملجم، وأوقفه عند حده بلهجة سعودية صارمة، واجعله يندم.

نظام التصويت (Polls):
إذا طلب المستخدم صراحة إنشاء تصويت، أرجع هذا الـ JSON فقط لا غير:
\`\`\`json
[{"question":"السؤال","options":["الخيار الأول","الخيار الثاني"]}]
\`\`\`
` + ALIASES_PROMPT;

const SEARCH_INSTRUCTION = SYSTEM_INSTRUCTION + `
ملاحظة هامة جداً وحازمة: 
أنت الآن متصل بالإنترنت. يجب عليك الاعتماد كلياً على أداة البحث (Google Search) للإجابة على سؤال المستخدم الحالي إذا تطلب الأمر.
يمنع منعاً باتاً التخمين أو تأليف الإجابات (الهلوسة). إذا طُلب منك كلمات أغنية، أسعار، أخبار، أو معلومات دقيقة، ابحث عنها فوراً وأعطِ الإجابة الدقيقة المستخرجة من الإنترنت.
`;

const chatModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite", 
    systemInstruction: SYSTEM_INSTRUCTION
});

const chatModelSearch = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite", 
    systemInstruction: SEARCH_INSTRUCTION,
    tools: [{ googleSearch: {} }] 
});

let db, historyCol;

// ==============================
// RPG Maps & Queues (Poetry/Story)
// ==============================
const rpgLobbies = new Map();
const activeRpgGames = new Map();

const poetryQueue = [];
let isPlayingPoetry = false;

let storyPlayerState = {
    player: null,
    queue: [],
    isPlaying: false,
    connection: null
};

async function processPoetryQueue() {
    if (isPlayingPoetry || poetryQueue.length === 0) return;
    isPlayingPoetry = true;
    
    const task = poetryQueue[0];
    await playPoetryWithBeat(task.connection, task.text, () => {
        poetryQueue.shift(); 
        isPlayingPoetry = false; 
        processPoetryQueue(); 
    });
}

// دالة تشغيل فقرات القصة بالترتيب
async function processStoryQueue() {
    if (storyPlayerState.queue.length === 0) {
        storyPlayerState.isPlaying = false;
        return;
    }
    
    storyPlayerState.isPlaying = true;
    const textChunk = storyPlayerState.queue.shift();

    try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata('ar-SA-HamedNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(textChunk);

        const player = createAudioPlayer();
        storyPlayerState.player = player; // حفظ المشغل للتحكم فيه (وقف/كمل)
        const resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary, inlineVolume: true });
        resource.volume.setVolume(1.0);

        if (storyPlayerState.connection) {
            // إيقاف الموسيقى لو كانت شغالة
            const currentMusic = storyPlayerState.connection.currentMusicPlayer;
            if (currentMusic && currentMusic.state.status === AudioPlayerStatus.Playing) {
                currentMusic.pause();
            }

            player.play(resource);
            storyPlayerState.connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, () => {
                processStoryQueue(); // شغل الفقرة اللي بعدها
            });

            player.on('error', (err) => {
                console.error("Story Player Error:", err);
                processStoryQueue();
            });
        }
    } catch (err) {
        console.error("TTS Story Error:", err);
        processStoryQueue();
    }
}

// ==============================
// Utils
// ==============================
function splitMessage(text) {
    const max = 1950;
    const chunks = [];
    for (let i = 0; i < text.length; i += max) {
        chunks.push(text.substring(i, i + max));
    }
    return chunks;
}

function getWavHeader(length) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(48000 * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(length, 40);
    return header;
}

function cleanJSON(text) {
    return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ==============================
// STT (Groq API)
// ==============================
async function transcribeBuffer(buffer) {
    try {
        const formData = new FormData();
        const blob = new Blob([buffer], { type: 'audio/wav' });
        
        formData.append('file', blob, 'audio.wav');
        formData.append('model', 'whisper-large-v3-turbo'); 
        formData.append('language', 'ar'); 

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: formData
        });

        if (!response.ok) {
            console.error("Groq API Error:", await response.text());
            return "";
        }

        const data = await response.json();
        return data.text || "";
    } catch (error) {
        console.error("Transcription Error:", error);
        return "";
    }
}

// ==============================
// Memory Management 
// ==============================
async function getUserContext(userId) {
    const messages = await historyCol.find({ userId }).sort({ timestamp: 1 }).toArray();
    
    if (messages.length === 0) return [];

    const lastMessage = messages[messages.length - 1];
    const now = new Date();
    const timeDiffMinutes = (now - new Date(lastMessage.timestamp)) / (1000 * 60);

    if (timeDiffMinutes > 15) {
        await historyCol.deleteMany({ userId });
        return [];
    }

    let formattedHistory = [];
    for (const msg of messages) {
        if (msg.role === 'user') {
            formattedHistory.push({ role: "user", parts: [{ text: msg.content }] });
        } 
        else if (msg.role === 'model') {
            formattedHistory.push({ role: "model", parts: [{ text: msg.content }] });
        }
    }
    
    return formattedHistory;
}

async function saveMessage(userId, role, content) {
    const now = new Date();
    const expireAt = new Date(now.getTime() + 60 * 60 * 1000); 

    await historyCol.insertOne({
        userId,
        role,
        content,
        timestamp: now,
        expireAt: expireAt 
    });
}

// ==============================
// Start Bot
// ==============================
async function startBot() {
    await mongoClient.connect();
    db = mongoClient.db("discord_bot_db");
    historyCol = db.collection("smart_chat_history");

    await historyCol.createIndex({ "expireAt": 1 }, { expireAfterSeconds: 0 });

    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });

    await client.login(discordToken);
    console.log("Bot Ready 🚀");
}

// ==============================
// RPG Interactions Router
// ==============================
client.on("interactionCreate", async (i) => {
    if (i.isButton()) {
        if (i.customId.startsWith("rpg_")) {
            return handleRpgLobbyButtons(i);
        }
    } else if (i.isStringSelectMenu()) {
        if (i.customId === "rpg_genres") {
            return handleRpgGenres(i);
        }
    }
});

client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    if (msg.content.trim().startsWith("كملها")) {
        const rest = msg.content.trim().slice(5).trim();
        const prompt = rest !== "" ? rest : "مغامرة عشوائية ومفاجئة";
        return startRpgLobby(msg, prompt);
    }

    if (msg.channel.isThread() && activeRpgGames.has(msg.channel.id)) {
        return handleRpgInput(msg);
    }
});

// ==============================
// Text Chat & Commands Logic 
// ==============================
client.on("messageCreate", async (msg) => {
    try {
        if (msg.channel.isThread() && activeRpgGames.has(msg.channel.id)) return;
        if (!ALLOWED_CHANNELS.includes(msg.channel.id)) return; 
        if (msg.author.bot) return;
        if (msg.content.trim().startsWith("كملها")) return; 

        const exactMessage = msg.content.trim();

// 🔥 1. ميزة توليد الصور (محدثة عشان تظهر في ديسكورد 100%) 🔥
        const imageRegex = /^(?:مودي\s+|حمودي\s+)?(?:سوي|ارسم|تخيل)\s+صورة\s+(.+)/i;
        const imageMatch = exactMessage.match(imageRegex);
        if (imageMatch) {
            const userPrompt = imageMatch[1].trim();
            const loadingMsg = await msg.reply("⏳ جاري الرسم... عطني ثواني أضبطها لك!");
            try {
                // ترجمة وتحسين الوصف عبر جيميناي
                const translationPrompt = `Translate the following image description to a very detailed English artistic prompt for an AI image generator. Make it professional and high quality: "${userPrompt}"`;
                const chat = chatModel.startChat();
                const res = await chat.sendMessage(translationPrompt);
                const englishPrompt = res.response.text().trim();

                const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?width=1024&height=1024&nologo=true`;

                // 🔥 الحل هنا: البوت يحمل الصورة أولاً كبيانات (Buffer) 🔥
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data, 'binary');
                const attachment = new AttachmentBuilder(buffer, { name: 'generated-image.jpg' });

                const embed = new EmbedBuilder()
                    .setTitle("✨ رسمت لك اللي في بالك!")
                    .setDescription(`**الطلب:** ${userPrompt}`)
                    .setImage('attachment://generated-image.jpg') // ربط الصورة بالملف المرفق
                    .setColor("#00ffcc")
                    .setFooter({ text: "بواسطة حمودي المبدع" });

                return loadingMsg.edit({ content: null, embeds: [embed], files: [attachment] });
            } catch (err) {
                console.error("Image Gen Error:", err);
                return loadingMsg.edit("❌ والله السيرفر حق الصور معلق أو الوصف مرفوض، جرب شيء ثاني.");
            }
        }

       // 🔥 2. ميزة توليد الأغاني (محدثة لتعمل مع مشروع Suno API المفتوح) 🔥
        const songRegex = /^(?:مودي\s+|حمودي\s+)?(?:سوي|ألف|لحن)\s+أغنية\s+(.+)/i;
        const songMatch = exactMessage.match(songRegex);
        if (songMatch) {
            const topic = songMatch[1].trim();
            const vc = msg.member.voice.channel;
            const statusMsg = await msg.reply("⏳ جاري كتابة الكلمات وتلحين الأغنية... بياخذ الموضوع دقيقة تقريباً 🎤");

            try {
                // 1. جيميناي يكتب الكلمات ويقرر الستايل
                const songPrompt = `اكتب كلمات أغنية قصيرة (بيتين وقرار) بالعامية أو الفصحى عن "${topic}". 
                اقترح "style" موسيقي بالإنجليزية (مثلاً: Sad Arabic Pop, Fast Rap, Khaleeji).
                أرجع النتيجة بصيغة JSON فقط كالتالي:
                \`\`\`json
                {"lyrics": "الكلمات هنا", "style": "الستايل هنا"}
                \`\`\``;
                
                const chat = chatModel.startChat();
                const result = await chat.sendMessage(songPrompt);
                const songData = JSON.parse(cleanJSON(result.response.text()));

                // 2. الإرسال لـ Suno API الخاص بك
                // ملاحظة: تأكد من إضافة SUNO_API_URL في إعدادات Render
                const sunoApiUrl = process.env.SUNO_API_URL; 

                const response = await axios.post(`${sunoApiUrl}/api/custom_generate`, {
                    prompt: songData.lyrics,
                    tags: songData.style,
                    title: topic,
                    make_instrumental: false,
                    wait_audio: true // ضروري جداً عشان البوت ينتظر لين تخلص الأغنية ويرجع الرابط
                });

                // Suno API المفتوح يرجع مصفوفة فيها خيارين (أغنيتين)، نختار الأولى دايماً
                const songUrl = response.data[0].audio_url; 

                if (vc) {
                    let conn = getVoiceConnection(msg.guild.id);
                    if (!conn) {
                        conn = joinVoiceChannel({ channelId: vc.id, guildId: vc.guild.id, adapterCreator: vc.guild.voiceAdapterCreator, selfDeaf: false });
                        conn.continuousMode = true; 
                        startListening(conn); 
                    }
                    await statusMsg.edit("✅ الأغنية جاهزة! بشغلها لك الحين بالفويس.");
                    playMusic(conn, songUrl); // تشغيلها في الروم
                } else {
                    await statusMsg.edit({ content: "✅ هذي أغنيتك يا فنان!", files: [songUrl] });
                }
            } catch (err) {
                console.error("Music Gen Error:", err);
                await statusMsg.edit("❌ الملحن واجه مشكلة.. تأكد إن رابط Suno API شغال في إعدادات ريندر وما عليه ضغط.");
            }
            return;
        }

        // 🛑 أوامر إيقاف/تشغيل القصة
        if (exactMessage === "وقف" || exactMessage === "قف" || exactMessage === "اسكت") {
            if (storyPlayerState.player && storyPlayerState.isPlaying) {
                storyPlayerState.player.pause();
                return msg.reply("⏸️ وقفت القصة مؤقتاً.");
            }
        }
        if (exactMessage === "كمل" || exactMessage === "استمر") {
            if (storyPlayerState.player && storyPlayerState.isPlaying) {
                storyPlayerState.player.unpause();
                return msg.reply("▶️ كملت القصة.");
            }
        }

        // 🔥 نظام سحب القصص من Reddit وترجمتها (Scraping + Gemini Translation)
        const storyRegex = /^(?:مودي\s+|حمودي\s+)?(?:قول|عطني|اسرد|ابي|أبي)\s*قصة\s*(.+)?/i;
        const storyMatch = exactMessage.match(storyRegex);

        if (storyMatch) {
            const requestedGenre = storyMatch[1] ? storyMatch[1].trim() : "عشوائية";
            const vc = msg.member.voice.channel;
            
            if (!vc) return msg.reply("❌ لازم تكون في روم صوتي عشان أحكيلك القصة!");

            let conn = getVoiceConnection(msg.guild.id);
            if (!conn) {
                conn = joinVoiceChannel({ channelId: vc.id, guildId: vc.guild.id, adapterCreator: vc.guild.voiceAdapterCreator, selfDeaf: false });
                conn.continuousMode = true; 
                startListening(conn); 
            }
            
            storyPlayerState.connection = conn;
            msg.reply(`📖 جاري البحث عن قصة **${requestedGenre}** حقيقية وترجمتها... جهزوا الشاي ☕`);

            try {
                // تحديد التصنيف لسحب القصة من Reddit
                let subreddit = "shortstories"; // افتراضي
                if (requestedGenre.includes("رعب") || requestedGenre.includes("مخيف")) subreddit = "shortscarystories";
                else if (requestedGenre.includes("خيال")) subreddit = "WritingPrompts";
                else if (requestedGenre.includes("غموض")) subreddit = "TheTruthIsHere";

                // سحب قصة عشوائية من ريديت
                const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=15`);
                const data = await res.json();
                
                // البحث عن بوست يحتوي على نص طويل كفاية (قصة)
                const posts = data.data.children.filter(p => p.data.selftext && p.data.selftext.length > 500);
                if (posts.length === 0) throw new Error("لا توجد قصص");

                // اختيار قصة عشوائية من القائمة
                const randomPost = posts[Math.floor(Math.random() * posts.length)];
                const rawEnglishStory = randomPost.data.selftext;

                // إرسال النص لـ Gemini للترجمة والتنظيف والصياغة الصوتية
                const translatePrompt = `أنت راوي قصص سعودي محترف. لقد تم سحب هذه القصة الإنجليزية من الإنترنت.
مهمتك:
1. ترجمة القصة إلى اللغة العربية الفصحى المبسطة أو اللهجة السعودية البيضاء لتكون ممتعة للاستماع.
2. تنظيف القصة من أي روابط، إعلانات، أو رموز غريبة.
3. اكتب القصة المترجمة فقط بدون أي مقدمات أو ردود.

القصة الإنجليزية:
${rawEnglishStory.substring(0, 3000)}`;

                const chat = chatModel.startChat();
                const translateRes = await chat.sendMessage(translatePrompt);
                let arabicStory = translateRes.response.text().trim();
                
                // تنظيف الإيموجيات عشان الـ TTS
                arabicStory = arabicStory.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

                // تقطيع القصة إلى فقرات (Chunks)
                const chunks = arabicStory.match(/.{1,600}(?:\s|$)/g) || [arabicStory];
                
                // تفريغ الطابور القديم وإضافة القصة الجديدة
                storyPlayerState.queue = [];
                storyPlayerState.queue.push(`اسمعوا هالقصة... بعنوان: ${randomPost.data.title}`);
                chunks.forEach(chunk => storyPlayerState.queue.push(chunk));
                storyPlayerState.queue.push("انتهت القصة، أتمنى تكون عجبتكم.");

                msg.channel.send(`✅ حصلت القصة وتمت الترجمة، بدأت أقراها لكم في الفويس! (للتوقف اكتب "وقف")`);
                
                if (!storyPlayerState.isPlaying) {
                    processStoryQueue();
                }

            } catch (err) {
                console.error("Story Fetch Error:", err);
                msg.channel.send("❌ ما قدرت أسحب قصة حالياً، السيرفرات مسدودة أو التصنيف غير متوفر.");
            }
            return;
        }

        // 🔥 نظام إلقاء الشعر عن طريق الشات المباشر
        const poetryRegex = /^(?:مودي\s+|حمودي\s+)?(قول شعر|سوي شعر|ألف شعر|الف شعر|عطني شعر|شعر)\s*(?:عن|في)?\s+(.+)/i;
        const poetryMatch = exactMessage.match(poetryRegex);

        if (poetryMatch) {
            const topic = poetryMatch[2].trim();
            const vc = msg.member.voice.channel;
            
            if (!vc) return msg.reply("❌ لازم تكون في روم صوتي عشان أسمعك الشعر والفخامة!");

            let conn = getVoiceConnection(msg.guild.id);
            if (!conn) {
                conn = joinVoiceChannel({
                    channelId: vc.id,
                    guildId: vc.guild.id,
                    adapterCreator: vc.guild.voiceAdapterCreator,
                    selfDeaf: false
                });
                conn.continuousMode = true; 
                startListening(conn); 
            }

            let queueStatus = isPlayingPoetry ? " (مُضاف للطابور ⏳)" : "";
            msg.reply(`جاري تأليف شعر عن **${topic}**...${queueStatus} اسمعني بالروم 🎤`);

            const prompt = `أنت شاعر عربي فحل ومخضرم. اكتب 3 أو 4 أبيات شعرية قوية وموزونة باللغة العربية الفصحى عن: "${topic}".
يجب أن تكون الأبيات مُشكّلة (بالحركات) لكي تُقرأ بشكل صحيح وواضح.
بدون أي إيموجي، وبدون أي مقدمات أو شروحات، اكتب الأبيات الشعرية فقط.`;

            try {
                const chat = chatModel.startChat();
                const res = await chat.sendMessage(prompt);
                let poem = res.response.text().trim();
                
                poem = poem.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ''); 
                let spokenPoem = "اسمع هالأبيات طال عمرك... \n" + poem.replace(/\n/g, " ،، \n");
                
                poetryQueue.push({ connection: conn, text: spokenPoem });
                processPoetryQueue();

            } catch (err) {
                console.error("خطأ في تأليف الشعر:", err);
                playAudio(conn, "والله القريحة الشعرية مقفلة الحين، المعذرة.");
            }
            return; 
        }

        // --- باقي الأوامر العادية ---
        if (exactMessage === "حمودي ادخل") {
            const vc = msg.member.voice.channel;
            if (!vc) return msg.reply("لازم تكون في روم صوتي!");

            const conn = joinVoiceChannel({
                channelId: vc.id,
                guildId: vc.guild.id,
                adapterCreator: vc.guild.voiceAdapterCreator,
                selfDeaf: false
            });

            conn.continuousMode = true; 
            startListening(conn);
            return msg.reply("دخلت الروم قاعد أسمعك 🎤");
        }

        if (exactMessage === "حمودي اخرج") {
            const conn = getVoiceConnection(msg.guild.id);
            if (conn) {
                conn.destroy();
                return msg.reply("طلعت من الروم 👋");
            }
            return msg.reply("أنا مو في روم أصلاً.");
        }

        const now = Date.now();
        if (userCooldown.has(msg.author.id)) {
            if (now < userCooldown.get(msg.author.id) + COOLDOWN) return;
        }
        userCooldown.set(msg.author.id, now);

        const startsWithBot = exactMessage.toLowerCase().startsWith("حمودي");
        const mentioned = msg.mentions.has(client.user);

        if (!startsWithBot && !mentioned) return;

        // 🔴 تنظيف الرسالة: يحذف منشن البوت فقط عشان يخلي باقي المنشنات تروح للذكاء الاصطناعي ويفهمها
        let cleanMessage = exactMessage.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
        if (cleanMessage.startsWith("حمودي")) {
            cleanMessage = cleanMessage.replace(/^حمودي/, "").trim();
        }

        const userId = msg.author.id;
        const chatHistory = await getUserContext(userId);

        const saudiTime = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
        const finalPrompt = `[الوقت]\n${saudiTime}\n\n[رسالة المستخدم]\n${cleanMessage}`;

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
            dailySearchCount++;
            console.log(`🔍 [بحث جوجل] تم استخدام البحث في الشات مع السجل الكامل. (الاستهلاك: ${dailySearchCount}/${SEARCH_LIMIT})`);
        } else {
            console.log(`⚠️ [بحث جوجل] تم الوصول للحد اليومي (${SEARCH_LIMIT})، تم تحويل الطلب للموديل العادي.`);
        }

        const chat = activeModel.startChat({
            history: chatHistory 
        });

        const result = await chat.sendMessage(parts);
        let responseText = result.response.text() || "لم أفهم الطلب.";

        if (responseText.includes("[الرد النهائي]")) {
            responseText = responseText.split("[الرد النهائي]")[1].trim();
            responseText = responseText.replace(/^["']|["']$/g, '').trim(); 
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
            return;
        }

        await saveMessage(userId, 'user', cleanMessage);
        await saveMessage(userId, 'model', responseText);

        const chunks = splitMessage(responseText);
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await msg.reply(chunks[i]).catch(console.error);
            } else {
                await msg.channel.send(chunks[i]).catch(console.error);
            }
        }

    } catch (e) {
        console.error("Chat Error:", e);
    }
});

// ==============================
// Voice Listening & Logic
// ==============================
function startListening(connection) {
    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
        if (userId === client.user.id || BLACKLISTED_USERS.includes(userId)) return;
        if (isProcessingVoice) return; 

        isProcessingVoice = true; 

        const stream = receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 }
        });

        const buffers = [];
        const pcm = stream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2 }));
        
        pcm.on('error', (err) => {
            if (err.message.includes('corrupted')) {
                return; 
            }
            console.error("PCM Decoder Error:", err);
        });
        
        pcm.on('data', (c) => buffers.push(c));

        pcm.on('end', async () => {
            const audio = Buffer.concat(buffers);
            if (audio.length < 100000) {
                isProcessingVoice = false; 
                return;
            }

            const wav = Buffer.concat([getWavHeader(audio.length), audio]);

            try {
                const text = await transcribeBuffer(wav);
                if (!text) {
                    isProcessingVoice = false;
                    return; 
                }
                
                const clean = text.trim().replace(/[.,!?،؟]/g, "");
                
                let isHallucination = false;
                for (const word of HALLUCINATIONS) {
                    if (clean.includes(word) && clean.split(" ").length <= 4) { 
                        isHallucination = true;
                        break;
                    }
                }

                if (isHallucination || clean.length < 2) {
                    console.log("🚫 تجاهل الهلوسة:", clean);
                    isProcessingVoice = false;
                    return;
                }

                console.log("سمع من", userId, ":", clean);

                const stopMusicRegex = /^(?:مودي\s+|حمودي\s+)?(وقف)(?:\s+(الاغنيه|الاغنية|المقطع))?$/i;
                const playRegex = /^(?:مودي\s+|حمودي\s+)?شغل\s+(.+)/i;
                const muteRegex = /^(?:مودي\s+|حمودي\s+)?(اسكت|أسكت|اصمت|أصمت|انطم|ولا كلمة)/i;
                const unmuteRegex = /^(?:مودي\s+|حمودي\s+)?(تكلم|اهرج|أهرج|سولف|ارجع|اصحى|رد)/i;
                const leaveRegex = /^(?:مودي\s+|حمودي\s+)?(اخرج|أخرج|اطلع|غادر)/i;

                const musicPlayer = connection.currentMusicPlayer;
                const isPlayingMusic = musicPlayer && musicPlayer.state.status === AudioPlayerStatus.Playing;

                // 🛑 تعديل ليتعامل مع الموسيقى والقصة في الفويس
                if (isPlayingMusic || storyPlayerState.isPlaying) {
                    if (stopMusicRegex.test(clean)) {
                        console.log("[Action] Stopped Music/Story.");
                        if (musicPlayer) musicPlayer.stop();
                        if (storyPlayerState.player) storyPlayerState.player.pause();
                    } else if (leaveRegex.test(clean)) {
                        console.log("[Action] Executing voice disconnect command.");
                        connection.destroy();
                    } else {
                        console.log("🚫 تجاهل السوالف لأن الأغنية/القصة شغالة");
                    }
                    isProcessingVoice = false;
                    return; 
                }

                if (stopMusicRegex.test(clean)) {
                    if (musicPlayer) musicPlayer.stop();
                    isProcessingVoice = false;
                    return;
                }

                if (leaveRegex.test(clean)) {
                    console.log("[Action] Executing voice disconnect command.");
                    connection.destroy();
                    isProcessingVoice = false;
                    return;
                }

                const playMatch = clean.match(playRegex);
                if (playMatch) {
                    const song = playMatch[1].trim();
                    console.log(`[Action] Playing: ${song}`);
                    playMusic(connection, song); 
                    isProcessingVoice = false;
                    return;
                }

                if (muteRegex.test(clean)) {
                    connection.continuousMode = false;
                    playAudio(connection, "حاضر طال عمرك، بسكت وما أرد إلا إذا ناديتني.");
                    isProcessingVoice = false;
                    return;
                }

                if (unmuteRegex.test(clean)) {
                    connection.continuousMode = true;
                    playAudio(connection, "أبشر، أنا معاك على الخط وأسمع كل شيء.");
                    isProcessingVoice = false;
                    return;
                }

                let commandText = "";
                let hasWakeWord = false;

                if (clean.startsWith("مودي ")) {
                    hasWakeWord = true;
                    commandText = clean.replace(/^مودي\s*/i, "");
                } else if (clean.startsWith("حمودي ")) {
                    hasWakeWord = true;
                    commandText = clean.replace(/^حمودي\s*/i, "");
                } else if (clean === "مودي" || clean === "حمودي") {
                    hasWakeWord = true;
                    commandText = clean; 
                }

                if (!connection.continuousMode && !hasWakeWord) {
                    isProcessingVoice = false;
                    return; 
                }

                if (connection.continuousMode && !hasWakeWord) {
                    commandText = clean;
                }

                if (commandText === "") {
                    isProcessingVoice = false;
                    return;
                }

                const chatHistory = await getUserContext(userId);
                const prompt = `
المستخدم قال: "${commandText}"

القواعد الصارمة:
1. إياك كتابة مسودة تفكير أو تحليل للسياق. أكتب الرد النهائي مباشرة.
2. رد عليه بلهجة سعودية طبيعية وعفوية بدون أي إيموجي.
`;
                
                const chat = chatModel.startChat({
                    history: chatHistory
                });

                const res = await chat.sendMessage(prompt);
                let reply = res.response.text().trim();
                
                if (reply.includes("[الرد النهائي]")) {
                    reply = reply.split("[الرد النهائي]")[1].trim();
                    reply = reply.replace(/^["']|["']$/g, '').trim(); 
                }
                reply = reply.replace(/\[السياق الداخلي\][\s\S]*?\[الرد المقترح\][\s\S]*?/gi, '').trim();
                reply = reply.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ''); 

                await saveMessage(userId, 'user', commandText);
                await saveMessage(userId, 'model', reply);

                playAudio(connection, reply);
                
                isProcessingVoice = false; 

            } catch (e) {
                console.error("Listening Error:", e);
                isProcessingVoice = false; 
            }
        });
    });
}

// ==============================
// الشعر + الإيقاع (FFmpeg - حفظ مؤقت ثم تشغيل)
// ==============================
async function playPoetryWithBeat(connection, text, onComplete) {
    try {
        console.log("⏳ [1] جاري تجهيز الإيقاع...");
        const beatsFolder = path.join(__dirname, 'beats');
        if (!fs.existsSync(beatsFolder)) fs.mkdirSync(beatsFolder);
        
        const beats = fs.readdirSync(beatsFolder).filter(f => f.endsWith('.mp3'));
        if (beats.length === 0) {
            console.log("⚠️ مجلد beats فاضي أو مافيه ملفات mp3، بشغل الصوت عادي بدون إيقاع.");
            return playAudio(connection, text, onComplete); 
        }
        
        const randomBeat = path.join(beatsFolder, beats[Math.floor(Math.random() * beats.length)]);
        console.log(`🎵 تم اختيار الإيقاع: ${path.basename(randomBeat)}`);

        console.log("⏳ [2] جاري توليد صوت الإلقاء (TTS)...");
        const tts = new MsEdgeTTS();
        await tts.setMetadata('ar-SA-HamedNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text);

        const uniqueId = Date.now();
        const tempTtsPath = path.join(__dirname, `temp_tts_${uniqueId}.mp3`);
        const tempMixPath = path.join(__dirname, `temp_mix_${uniqueId}.mp3`);

        const writeStream = fs.createWriteStream(tempTtsPath);
        audioStream.pipe(writeStream);

        writeStream.on('finish', () => {
            console.log("✅ [3] تم حفظ الصوت، جاري الدمج مع الموسيقى...");            
            
            const ffmpegArgs = [
                '-i', randomBeat,                
                '-i', tempTtsPath,              
                '-filter_complex', '[0:a:0]volume=0.15[bg];[1:a:0]volume=1.5[tts];[bg][tts]amix=inputs=2:duration=shortest[out]',
                '-map', '[out]',
                '-y', 
                tempMixPath 
            ];

            const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

            ffmpegProcess.on('close', (code) => {
                let isMixValid = false;
                if (fs.existsSync(tempMixPath)) {
                    const stats = fs.statSync(tempMixPath);
                    if (stats.size > 1000) isMixValid = true; 
                }

                if (code !== 0 || !isMixValid) {
                    console.error(`❌ فشل الدمج السحري للموسيقى. جاري تشغيل الإلقاء الصافي كاحتياط.`);
                    return playGeneratedAudio(connection, tempTtsPath, tempMixPath, onComplete); 
                }

                console.log("✅ [4] تم الدمج بنجاح، جاري التشغيل في الروم 🔊");
                playGeneratedAudio(connection, tempMixPath, tempTtsPath, onComplete);
            });
        });

    } catch (err) {
        console.error("❌ خطأ عام في دمج الصوت:", err);
        playAudio(connection, text, onComplete); 
    }
}

function playGeneratedAudio(connection, fileToPlay, otherFileToClean, onComplete) {
    const resource = createAudioResource(fileToPlay, { inlineVolume: true });
    resource.volume.setVolume(1.0);
    const player = createAudioPlayer();
    
    const currentMusic = connection.currentMusicPlayer;
    if (currentMusic && currentMusic.state.status === AudioPlayerStatus.Playing) {
        currentMusic.pause();
    }

    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
        console.log("⏹️ [5] انتهى الإلقاء، جاري تنظيف الملفات المؤقتة...");
        if (fs.existsSync(fileToPlay)) fs.unlinkSync(fileToPlay);
        if (fs.existsSync(otherFileToClean)) fs.unlinkSync(otherFileToClean);
        
        if (currentMusic) {
            connection.subscribe(currentMusic);
            currentMusic.unpause();
        }
        if (onComplete) onComplete();
    });

    player.on('error', (err) => {
        console.error("❌ خطأ أثناء التشغيل:", err);
        if (fs.existsSync(fileToPlay)) fs.unlinkSync(fileToPlay);
        if (fs.existsSync(otherFileToClean)) fs.unlinkSync(otherFileToClean);
        if (onComplete) onComplete();
    });
}

// ==============================
// TTS العادي (للسوالف) 
// ==============================
async function playAudio(connection, text, onComplete) {
    try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata('ar-SA-HamedNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const { audioStream } = tts.toStream(text);
        const ttsPlayer = createAudioPlayer();
        const resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary, inlineVolume: true });
        
        resource.volume.setVolume(1.0); 

        const musicPlayer = connection.currentMusicPlayer;
        const wasPlayingMusic = musicPlayer && musicPlayer.state.status === AudioPlayerStatus.Playing;

        if (wasPlayingMusic) {
            musicPlayer.pause(); 
        }

        ttsPlayer.play(resource);
        connection.subscribe(ttsPlayer);

        ttsPlayer.on(AudioPlayerStatus.Idle, () => {
            if (wasPlayingMusic && connection.currentMusicPlayer) {
                connection.subscribe(connection.currentMusicPlayer);
                connection.currentMusicPlayer.unpause(); 
            }
            if (onComplete) onComplete();
        });

        ttsPlayer.on('error', (err) => {
            console.error("TTS Player Error:", err);
            if (wasPlayingMusic && connection.currentMusicPlayer) {
                connection.subscribe(connection.currentMusicPlayer);
                connection.currentMusicPlayer.unpause();
            }
            if (onComplete) onComplete();
        });

    } catch (err) {
        console.error("TTS Error:", err);
        if (onComplete) onComplete();
    }
}

// ==============================
// Music
// ==============================
async function playMusic(connection, queryOrUrl) {
    try {
        let streamUrl = queryOrUrl;
        
        // إذا كان رابط جاهز من الـ API (زي رابط Suno)
        if (!queryOrUrl.startsWith('http')) {
             const results = await play.search(queryOrUrl, { limit: 1, source: { soundcloud: "tracks" } });
             if (!results.length) return;
             const stream = await play.stream(results[0].url);
             streamUrl = stream.stream;
        }

        const player = createAudioPlayer();
        // تمرير الرابط المباشر أو الـ stream
        const resource = createAudioResource(streamUrl, { inlineVolume: true });

        resource.volume.setVolume(currentMusicVolume);

        player.play(resource);
        connection.subscribe(player);

        connection.currentMusicPlayer = player;
        connection.currentAudioResource = resource;
    } catch (err) {
        console.error("Music Error:", err);
    }
}

// ==========================================
// 🐉 نظام لعبة القصة (RPG) المدمج
// ==========================================

async function startRpgLobby(msg, customPrompt) {
    const channelId = msg.channel.id;
    if (rpgLobbies.has(channelId)) return msg.reply("❌ فيه لوبي قصة مفتوح بهذي القناة أصلاً!");

    const lobby = {
        hostId: msg.author.id,
        prompt: customPrompt,
        genres: [],
        voiceMode: false,
        vcId: null,
        players: new Map(),
        status: "waiting",
        msgId: null
    };
    
    lobby.players.set(msg.author.id, msg.author.username);
    rpgLobbies.set(channelId, lobby);

    await sendOrUpdateLobby(msg.channel, lobby);
}

async function sendOrUpdateLobby(channel, lobby, interaction = null) {
    const genresText = lobby.genres.length > 0 ? lobby.genres.join("، ") : "لم يتم التحديد (عشوائي)";
    const embed = new EmbedBuilder()
        .setTitle("🐉 تجهيز رحلة قصة جديدة!")
        .setColor("#FF4500")
        .setDescription(`**السيناريو:** ${lobby.prompt}\n**التصنيفات:** ${genresText}\n\n**اللاعبين (${lobby.players.size}):**\n${Array.from(lobby.players.keys()).map(id => `<@${id}>`).join("\n")}`);

    const genresMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("rpg_genres")
            .setPlaceholder("🎭 اختر تصنيفات القصة...")
            .setMinValues(1)
            .setMaxValues(4)
            .addOptions([
                { label: "أكشن", value: "أكشن", emoji: "⚔️" },
                { label: "رعب", value: "رعب", emoji: "👻" },
                { label: "غموض", value: "غموض", emoji: "🕵️" },
                { label: "كوميدي", value: "كوميدي", emoji: "😂" },
                { label: "دراما", value: "دراما", emoji: "🎭" },
                { label: "رومانسي", value: "رومانسي", emoji: "❤️" },
                { label: "خيال علمي", value: "خيال علمي", emoji: "🚀" }
            ])
    );

    const buttonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rpg_join").setLabel("انضمام").setStyle(ButtonStyle.Success).setEmoji("✅"),
        new ButtonBuilder()
            .setCustomId("rpg_voice_toggle")
            .setLabel("الوضع الصوتي")
            .setStyle(lobby.voiceMode ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji("🎙️"),
        new ButtonBuilder().setCustomId("rpg_start").setLabel("ابدأ القصة").setStyle(ButtonStyle.Primary).setEmoji("🚀"),
        new ButtonBuilder().setCustomId("rpg_cancel").setLabel("إلغاء").setStyle(ButtonStyle.Danger).setEmoji("❌")
    );

    const components = [genresMenu, buttonsRow];

    if (interaction && lobby.msgId) {
        await interaction.update({ embeds: [embed], components });
    } else {
        const lobbyMsg = await channel.send({ embeds: [embed], components });
        lobby.msgId = lobbyMsg.id;
    }
}

async function handleRpgGenres(i) {
    const lobby = rpgLobbies.get(i.channel.id);
    if (!lobby || lobby.status !== "waiting") return i.reply({ content: "❌ اللوبي مغلق أو بدأ.", ephemeral: true });
    if (i.user.id !== lobby.hostId) return i.reply({ content: "❌ الهوست بس يقدر يحدد تصنيف القصة.", ephemeral: true });

    lobby.genres = i.values;
    await sendOrUpdateLobby(i.channel, lobby, i);
}

async function handleRpgLobbyButtons(i) {
    const channelId = i.channel.id;
    
    if (i.customId === "rpg_quit") {
        const threadId = i.channel.id;
        const game = activeRpgGames.get(threadId);
        if (!game) return i.reply({ content: "❌ اللعبة غير موجودة.", ephemeral: true });

        const playerIndex = game.players.findIndex(p => p.id === i.user.id);
        if (playerIndex === -1) return i.reply({ content: "❌ أنت لست مشاركاً في هذه القصة.", ephemeral: true });

        game.players.splice(playerIndex, 1);
        await i.reply({ content: `🚪 <@${i.user.id}> انسحب من الرحلة! بنكمل بدونه.` });

        if (game.players.length === 0) {
            await i.channel.send("💀 الجميع انسحب! انتهت القصة هنا.");
            activeRpgGames.delete(threadId);
        } else if (game.players.every(p => p.action !== null)) {
            executeRpgTurn(threadId);
        }
        return;
    }

    const lobby = rpgLobbies.get(channelId);
    if (!lobby || lobby.status !== "waiting") return;

    if (i.customId === "rpg_join") {
        if (lobby.players.has(i.user.id)) return i.reply({ content: "❌ أنت موجود بالرحلة أصلاً!", ephemeral: true });
        lobby.players.set(i.user.id, i.user.username);
        await sendOrUpdateLobby(i.channel, lobby, i);
        return;
    }

    if (i.customId === "rpg_voice_toggle") {
        if (i.user.id !== lobby.hostId) return i.reply({ content: "❌ الهوست بس يقدر يفعل المايك.", ephemeral: true });
        
        const vc = i.member.voice.channel;
        if (!lobby.voiceMode) {
            if (!vc) return i.reply({ content: "❌ لازم تكون داخل روم صوتي عشان تفعل هذا الخيار!", ephemeral: true });
            lobby.voiceMode = true;
            lobby.vcId = vc.id;
        } else {
            lobby.voiceMode = false;
            lobby.vcId = null;
        }
        await sendOrUpdateLobby(i.channel, lobby, i);
        return;
    }

    if (i.customId === "rpg_cancel") {
        if (i.user.id !== lobby.hostId) return i.reply({ content: "❌ الهوست بس يقدر يلغي.", ephemeral: true });
        rpgLobbies.delete(channelId);
        return i.update({ content: "❌ تم إلغاء الرحلة.", embeds: [], components: [] });
    }

    if (i.customId === "rpg_start") {
        if (i.user.id !== lobby.hostId) return i.reply({ content: "❌ الهوست بس يقدر يبدأ اللعب.", ephemeral: true });
        await i.update({ content: "⏳ جاري تجهيز الثريد وبناء العالم...", embeds: [], components: [] });
        lobby.status = "starting";
        await initiateRpgGame(i.channel, lobby);
    }
}

async function initiateRpgGame(channel, lobby) {
    const threadName = `قصة-${lobby.players.values().next().value}`.substring(0, 90);
    const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 60,
        type: 11
    });

    const playersList = Array.from(lobby.players.entries()).map(([id, name]) => ({ id, name }));
    const pMentions = playersList.map(p => `<@${p.id}>`).join(" ");
    const genresText = lobby.genres.length > 0 ? lobby.genres.join(" و ") : "عشوائي";
    
    await thread.send(`🎮 حياكم الله في عالمكم الجديد ${pMentions}\nتصنيف القصة: **${genresText}**\nبدأت القصة، خذوا وقتكم في الرد!`);

    const systemInstruction = `
أنت Dungeon Master صارم جداً، وتدير لعبة RPG نصية.
- فكرة القصة الأساسية: ${lobby.prompt}
- تصنيفات القصة المطلوبة بدقة: ${genresText}.
- اللاعبون: ${JSON.stringify(playersList)}

تعليمات اللعب الأساسية والصرامة:
1. امنع الأفعال التخريبية (مثل قتل لاعب لصديقه، الانتحار بدون سبب، أو القيام بأشياء خارقة للمنطق). إذا فعل أحدهم ذلك، عاقبه فوراً بالفشل الذريع، أو التسبب بضرر لنفسه، وكن حازماً ولا تجامله.
2. القصة تتكون من 5 جولات فقط. الجولة الأولى هي البداية. في الجولة الأخيرة (الخامسة)، يجب أن تنهي القصة تماماً بفوزهم أو خسارتهم المنطقية، وضع "isGameOver": true.
3. وزع شخصيات وأدوات في الجولة الأولى بناءً على التصنيف.
4. الرد بصيغة JSON حصراً بدون أي نصوص أو markdown:
{
  "scenario": "وصف المشهد المشوق وردة فعل صارمة على أفعالهم",
  "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
  "playersState": [{"id": "...", "role": "...", "inventory": "..."}],
  "isGameOver": false
}`;

    const rpgModel = genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite-preview",
        systemInstruction: systemInstruction
    });

    const chatSession = rpgModel.startChat();

    const game = {
        threadId: thread.id,
        chat: chatSession,
        players: playersList.map(p => ({ ...p, action: null })),
        round: 1,
        options: [],
        mainMsg: null,
        voiceMode: lobby.voiceMode,
        vcId: lobby.vcId,
        guildId: channel.guild.id
    };
    
    activeRpgGames.set(thread.id, game);
    rpgLobbies.delete(channel.id);

    await processRpgRound(thread.id, "ابدأ القصة المشوقة الآن، وزع الأدوار وضعهم في المأزق الأول.");
}

async function playRpgVoiceText(guildId, vcId, text) {
    if (!vcId || !guildId) return;
    try {
        const guild = await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(vcId);
        if (!channel) return;

        let connection = getVoiceConnection(guild.id);
        if (!connection) {
            connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });
        }

        const tts = new MsEdgeTTS();
        await tts.setMetadata('ar-SA-HamedNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text);

        const ttsPlayer = createAudioPlayer();
        const resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary });
        ttsPlayer.play(resource);
        connection.subscribe(ttsPlayer);
    } catch (e) {
        console.error("RPG Voice TTS Error:", e);
    }
}

async function processRpgRound(threadId, userInput) {
    const game = activeRpgGames.get(threadId);
    if (!game) return;
    const thread = await client.channels.fetch(threadId);
    
    try {
        const response = await game.chat.sendMessage(userInput);
        const jsonText = cleanJSON(response.response.text());
        const data = JSON.parse(jsonText);

        game.options = data.options || [];
        game.players.forEach(p => p.action = null);

        if (game.voiceMode && game.vcId) {
            playRpgVoiceText(game.guildId, game.vcId, data.scenario);
        }

        const embed = new EmbedBuilder()
            .setTitle(`📜 الجولة ${game.round}`)
            .setColor("#8A2BE2")
            .setDescription(data.scenario);

        const componentsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("rpg_quit")
                .setLabel("انسحاب من القصة")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("🚪")
        );

        if (data.isGameOver) {
            embed.setTitle("🎬 نهاية القصة");
            embed.setColor(data.scenario.includes("نجاح") || data.scenario.includes("فوز") ? "Green" : "DarkRed");
            await thread.send({ embeds: [embed] });
            activeRpgGames.delete(threadId);
            return;
        }

        embed.addFields({
            name: "الخيارات المتاحة (أرسل الرقم أو اكتب ردك الخاص):",
            value: `1️⃣ ${data.options[0]}\n2️⃣ ${data.options[1]}\n3️⃣ ${data.options[2]}\n4️⃣ ${data.options[3]}`
        });

        if (data.playersState) {
            data.playersState.forEach(p => {
                const playerObj = game.players.find(x => x.id === p.id);
                if(playerObj) {
                     embed.addFields({ name: `${playerObj.name} (${p.role})`, value: `🎒 الأدوات: ${p.inventory}\n⏳ الحالة: ينتظر القرار`, inline: true });
                }
            });
        }

        game.mainMsg = await thread.send({ embeds: [embed], components: [componentsRow] });
        game.round++;
    } catch (e) {
        console.error("RPG Parse Error:", e);
        thread.send("❌ الذكاء الاصطناعي واجه مشكلة في صياغة القصة.. جاري المحاولة مرة أخرى.");
        setTimeout(() => processRpgRound(threadId, "حدث خطأ، يرجى إعادة صياغة المشهد الأخير بصيغة JSON صحيحة."), 3000);
    }
}

async function handleRpgInput(msg) {
    const game = activeRpgGames.get(msg.channel.id);
    if (!game) return;

    const player = game.players.find(p => p.id === msg.author.id);
    if (!player) return;

    if (player.action !== null) {
        return msg.reply("⏳ سجلت قرارك، انتظر الباقين!").then(m => setTimeout(()=>m.delete().catch(()=>{}), 3000));
    }

    let actionText = msg.content.trim();
    if (["1", "2", "3", "4"].includes(actionText) && game.options[parseInt(actionText) - 1]) {
        actionText = game.options[parseInt(actionText) - 1]; 
    }

    player.action = actionText;
    await msg.react('✅').catch(()=>{});

    if (game.mainMsg) {
        const embed = EmbedBuilder.from(game.mainMsg.embeds[0]);
        const fieldIndex = embed.data.fields.findIndex(f => f.name.includes(player.name));
        if (fieldIndex !== -1) {
            embed.data.fields[fieldIndex].value = embed.data.fields[fieldIndex].value.replace("⏳ الحالة: ينتظر القرار", "✅ الحالة: جاهز");
            game.mainMsg.edit({ embeds: [embed] }).catch(()=>{});
        }
    }

    if (game.players.every(p => p.action !== null)) {
        executeRpgTurn(game.threadId);
    }
}

async function executeRpgTurn(threadId) {
    const game = activeRpgGames.get(threadId);
    if(!game) return;
    const thread = await client.channels.fetch(threadId);
    
    await thread.send("🔄 جاري تحليل قراراتكم ونسج الأحداث...").then(m => setTimeout(()=>m.delete().catch(()=>{}), 4000));

    let compiledActions = "انتهت الجولة، قرارات اللاعبين هي:\n";
    game.players.forEach(p => {
        compiledActions += `- اللاعب (Name: ${p.name}) قرر: ${p.action}\n`;
    });
    
    if (game.round >= 5) {
        compiledActions += "\nهذه هي الجولة الأخيرة! أحسم مصيرهم بناءً على أفعالهم بشكل منطقي وقاطع، وضع 'isGameOver': true.";
    } else {
        compiledActions += "\nأكمل القصة بناءً على قراراتهم وأعطنا نتائج أفعالهم. كن صارماً جداً وعاقب من يحاول العبث أو التخريب.";
    }

    await processRpgRound(threadId, compiledActions);
}

startBot();
