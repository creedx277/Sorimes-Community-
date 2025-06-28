const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config.json');
const fs = require('fs').promises;
const express = require('express');
const app = express();

// Armazena tickets em criação para evitar duplicatas
const activeTicketCreations = new Set();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Função para carregar as regras do arquivo
async function loadRules() {
    try {
        const data = await fs.readFile('./ticketRules.json');
        return JSON.parse(data);
    } catch (err) {
        console.error('Erro ao carregar regras:', err);
        return { panelRules: [], ticketRules: [] };
    }
}

// Função para salvar as regras no arquivo
async function saveRules(rules) {
    try {
        await fs.writeFile('./ticketRules.json', JSON.stringify(rules, null, 2));
        return true;
    } catch (err) {
        console.error('Erro ao salvar regras:', err);
        return false;
    }
}

// Função para enviar o painel de tickets
async function sendTicketPanel() {
    const channel = client.channels.cache.get(config.ticketChannelId);
    if (!channel) {
        console.error('Canal de tickets não encontrado!');
        return;
    }

    const rules = await loadRules();
    const panelRulesText = rules.panelRules.map((rule, index) => `${rule}`).join('\n');

    const embed = new EmbedBuilder()
        .setTitle('Sorimes Community - Sistema de Tickets')
        .setDescription(
            'Bem-vindo(a) à categoria de suporte da Sorimes Community! Este canal é destinado a suportes gerais, parcerias, entre outros.\n' +
            '**O mal uso da ferramenta de suporte terá punição a critério da equipe de moderação.**\n\n' +
            '**Regras:**\n' +
            `${panelRulesText}\n\n` +
            'Escolha uma categoria para abrir um ticket:'
        )
        .setColor('#5865F2')
        .setFooter({ text: 'Sorimes Community - Suporte e Parcerias' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_category')
        .setPlaceholder('Selecione uma categoria')
        .addOptions([
            { label: '🤔 Dúvidas', value: 'duvidas' },
            { label: '⚠️ Denúncias', value: 'denuncias' },
            { label: '💱 Reembolso', value: 'reembolso' },
            { label: '🤝 Parceria', value: 'parceria' },
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await channel.send({ embeds: [embed], components: [row] });
}

client.once('ready', () => {
    console.log(`Bot conectado como ${client.user.tag}`);
    sendTicketPanel();
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
        if (interaction.replied || interaction.deferred) return;

        const { values, user, guild } = interaction;
        const categoryMap = {
            'duvidas': 'Dúvidas',
            'denuncias': 'Denúncias',
            'reembolso': 'Reembolso',
            'parceria': 'Parceria'
        };
        const category = categoryMap[values[0]];

        const ticketKey = `${user.id}-${category}`;
        if (activeTicketCreations.has(ticketKey)) {
            await interaction.reply({ content: 'Você já tem um ticket em criação. Aguarde um momento.', ephemeral: true });
            return;
        }

        activeTicketCreations.add(ticketKey);

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            activeTicketCreations.delete(ticketKey);
            await interaction.reply({ content: 'Não foi possível carregar suas informações. Tente novamente.', ephemeral: true });
            return;
        }

        const supportRole = await guild.roles.fetch(config.supportRoleId).catch((err) => {
            console.error('Erro ao buscar cargo de suporte:', err);
            activeTicketCreations.delete(ticketKey);
            interaction.reply({ content: 'Erro: Cargo de suporte não configurado corretamente. Verifique o supportRoleId no config.json.', ephemeral: true });
            return null;
        });
        if (!supportRole) {
            activeTicketCreations.delete(ticketKey);
            return;
        }

        try {
            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}-${category.toLowerCase().replace(' ', '-')}`,
                type: 0,
                parent: config.ticketCategoryId,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: ['ViewChannel'],
                    },
                    {
                        id: member.id,
                        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                    },
                    {
                        id: supportRole.id,
                        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                    },
                ],
            });

            const reply = await interaction.reply({ content: `Ticket criado com sucesso! Veja em ${ticketChannel}`, fetchReply: true, ephemeral: true });
            if (!reply) {
                console.error('Falha ao responder à interação.');
                activeTicketCreations.delete(ticketKey);
                return;
            }

            const rules = await loadRules();
            const ticketRulesText = rules.ticketRules.map((rule, index) => `${rule}`).join('\n');

            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Fechar Ticket')
                .setStyle(ButtonStyle.Danger);

            const buttonRow = new ActionRowBuilder().addComponents(closeButton);

            const ticketEmbed = new EmbedBuilder()
                .setTitle(`Ticket - ${category}`)
                .setDescription(
                    `Olá ${user}, bem-vindo ao seu ticket para **${category}**. Por favor, explique sua solicitação. Nossa equipe responderá em breve!\n\n` +
                    '**Regras do Ticket:**\n' +
                    `${ticketRulesText}`
                )
                .setColor('#5865F2');

            await ticketChannel.send({ content: `${user} <@&${config.supportRoleId}>`, embeds: [ticketEmbed], components: [buttonRow] });
            await ticketChannel.setTopic(user.id);
        } catch (err) {
            console.error('Erro ao criar canal:', err);
            if (!interaction.replied && !interaction.deferred) {
                if (err.code === 50013) {
                    await interaction.reply({ content: 'Não tenho permissão para criar um canal nesta categoria.', ephemeral: true });
                } else if (err.code === 10003) {
                    await interaction.reply({ content: 'A categoria especificada não foi encontrada. Verifique o ID da categoria.', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'Houve um erro ao criar o ticket, tente novamente.', ephemeral: true });
                }
            }
        } finally {
            activeTicketCreations.delete(ticketKey);
        }
    } else if (interaction.isButton() && interaction.customId === 'close_ticket') {
        if (interaction.replied || interaction.deferred) return;

        const member = interaction.member;
        if (!member.roles.cache.has(config.supportRoleId)) {
            await interaction.reply({ content: 'Você não tem permissão para fechar este ticket.', ephemeral: true });
            return;
        }

        await interaction.reply({ content: 'Fechando o ticket...', ephemeral: true });
        await interaction.channel.delete().catch(err => console.error('Erro ao deletar canal:', err));
    }
});

// Configurar API para o site
app.use(express.json());
app.use(express.static('web'));

app.post('/api/update-rules', async (req, res) => {
    const { panelRules, ticketRules } = req.body;

    const rules = { panelRules, ticketRules };
    const success = await saveRules(rules);

    if (success) {
        // Atualizar o painel de tickets no Discord
        await sendTicketPanel();
        res.json({ message: 'Regras atualizadas com sucesso' });
    } else {
        res.status(500).json({ error: 'Erro ao salvar regras' });
    }
});

app.get('/api/bot-status', (req, res) => {
    const isOnline = client.readyAt !== null && client.ws.status === 0;
    res.json({ online: isOnline });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor API rodando na porta ${PORT}`);
});

client.login(config.token);