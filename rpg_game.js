// rpg_game.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getVoiceConnection, joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const rpgLobbies = new Map();
const activeRpgGames = new Map();

module.exports = {
    handleRpgCommands: async function(msg) {
        if (msg.content.trim().startsWith("قصة")) {
            const rest = msg.content.trim().slice(5).trim();
            const prompt = rest !== "" ? rest : "مغامرة عشوائية ومفاجئة";
            await this.startRpgLobby(msg, prompt);
            return true;
        }
        if (msg.channel.isThread() && activeRpgGames.has(msg.channel.id)) {
            await this.handleRpgInput(msg);
            return true;
        }
        return false;
    },

    handleRpgInteraction: async function(i, genAI, client) {
        if (i.isButton()) {
            if (i.customId.startsWith("rpg_")) {
                return this.handleButtons(i, genAI, client);
            }
        } else if (i.isStringSelectMenu()) {
            if (i.customId === "rpg_genres") {
                return this.handleRpgGenres(i);
            }
        }
    },

    startRpgLobby: async function(msg, customPrompt) {
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

        await this.sendOrUpdateLobby(msg.channel, lobby);
    },

    sendOrUpdateLobby: async function(channel, lobby, interaction = null) {
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
            new ButtonBuilder().setCustomId("rpg_join").setLabel("انضمام").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("rpg_voice_toggle")
                .setLabel("الوضع الصوتي")
                .setStyle(lobby.voiceMode ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji("🎙️"),
            new ButtonBuilder().setCustomId("rpg_start").setLabel("ابدأ القصة").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("rpg_cancel").setLabel("إلغاء").setStyle(ButtonStyle.Danger)
        );

        const components = [genresMenu, buttonsRow];

        if (interaction && lobby.msgId) {
            await interaction.update({ embeds: [embed], components });
        } else {
            const lobbyMsg = await channel.send({ embeds: [embed], components });
            lobby.msgId = lobbyMsg.id;
        }
    },

    handleRpgGenres: async function(i) {
        const lobby = rpgLobbies.get(i.channel.id);
        if (!lobby || lobby.status !== "waiting") return i.reply({ content: "❌ اللوبي مغلق أو بدأ.", ephemeral: true });
        if (i.user.id !== lobby.hostId) return i.reply({ content: "❌ الهوست بس يقدر يحدد تصنيف القصة.", ephemeral: true });

        lobby.genres = i.values;
        await this.sendOrUpdateLobby(i.channel, lobby, i);
    },

    handleButtons: async function(i, genAI, client) {
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
                this.executeRpgTurn(threadId, client);
            }
            return;
        }

        const lobby = rpgLobbies.get(channelId);
        if (!lobby || lobby.status !== "waiting") return;

        if (i.customId === "rpg_join") {
            if (lobby.players.has(i.user.id)) return i.reply({ content: "❌ أنت موجود بالرحلة أصلاً!", ephemeral: true });
            lobby.players.set(i.user.id, i.user.username);
            await this.sendOrUpdateLobby(i.channel, lobby, i);
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
            await this.sendOrUpdateLobby(i.channel, lobby, i);
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
            await this.initiateRpgGame(i.channel, lobby, genAI, client);
        }
    },

    initiateRpgGame: async function(channel, lobby, genAI, client) {
        const threadName = `قصة-${lobby.players.values().next().value}`.substring(0, 90);
        const thread = await channel.threads.create({
            name: threadName,
            autoArchiveDuration: 60,
            type: 11
        });

        const playersList = Array.from(lobby.players.entries()).map(([id, name]) => ({ id, name, action: null }));
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
            players: playersList,
            round: 1,
            options: [],
            mainMsg: null,
            voiceMode: lobby.voiceMode,
            vcId: lobby.vcId,
            guildId: channel.guild.id
        };
        
        activeRpgGames.set(thread.id, game);
        rpgLobbies.delete(channel.id);

        await this.processRpgRound(thread.id, "ابدأ القصة المشوقة الآن، وزع الأدوار وضعهم في المأزق الأول.", client);
    },

    playRpgVoiceText: async function(guildId, vcId, text, client) {
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
    },

    processRpgRound: async function(threadId, userInput, client) {
        const game = activeRpgGames.get(threadId);
        if (!game) return;
        const thread = await client.channels.fetch(threadId);
        
        try {
            const response = await game.chat.sendMessage(userInput);
            let jsonText = response.response.text();
            jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(jsonText);

            game.options = data.options || [];
            game.players.forEach(p => p.action = null);

            if (game.voiceMode && game.vcId) {
                this.playRpgVoiceText(game.guildId, game.vcId, data.scenario, client);
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
            setTimeout(() => this.processRpgRound(threadId, "حدث خطأ، يرجى إعادة صياغة المشهد الأخير بصيغة JSON صحيحة.", client), 3000);
        }
    },

    handleRpgInput: async function(msg) {
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
            this.executeRpgTurn(game.threadId, msg.client);
        }
    },

    executeRpgTurn: async function(threadId, client) {
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

        await this.processRpgRound(threadId, compiledActions, client);
    }
};