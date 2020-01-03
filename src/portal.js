const _ = require('lodash')
const btoa = require('base-64')
const moment = require('moment')
const axios = require('axios')
const Botkit = require('botkit')
const random = require('randomstring')
const { promisify } = require('es6-promisify')
const templates = require('./slack_templates')

let plugin

function BotkitPortalPlugin(config) {
    plugin = {
        name: 'Slack Portal Plugin',
        config: config
    }

    if (config.controller) plugin.controller = config.controller
    if (!config.receiver_url) throw new Error(`receiver_url missing: Need Slack app base URL to recieve validate incoming responses from the Portal app`)
    if (!config.portal_token) throw new Error(`config.portal_token missing: Need an authentication token from the Portal app`)
    if (!config.client_secret) throw new Error(`config.client_token missing: Need a client verification token to validate incoming responses from the Portal app`)
    if (!config.listeners) {
        let keywords = ['support','help','helpdesk','feedback']
        config.listeners = {
            keywords,
            slash_command: {
                feedback: null, // null captures all text after /feedback
                support: null,
                help: null,
                helpdesk: null
            },
            at_mention: true //keywords
        }
    }
    plugin.receiver_url = config.receiver_url
    plugin.portal_url = config.portal_url? config.portal_url : 'https://app.portalforslack.com' 
    plugin.callback_id = config.callback_id? config.callback_id : 'action_portal_launch'
    plugin.no_passthrough = config.no_passthrough ? config.no_passthrough : false
    setupUsageTracker(plugin)
    plugin.init = (controller) => init(controller)
    // plugin.verifyPassback = (req) => verifyPassback(plugin, req)
    // plugin.processPassback = (req, res) => processPassback(plugin, req, res)
    // plugin.processIncomingMessage = (bot, message, next) => processIncomingMessage(plugin, bot, message, next)
    // plugin.handle_dm()

    return plugin
}

async function init(controller) {
    try {
        plugin.controller = controller
        let router = plugin.config.webserver ? plugin.config.webserver : controller.webserver
        if (!router) throw new Error('no_webserver_found')
        let scopes = controller.config.scopes? controller.config.scopes : []
        if (!_.isArray(scopes)) scopes = scopes.split(',')
        if (!_.includes(scopes, 'bot') && _.size(_.intersection(scopes, ['im:history','im:write','im:read'])) != 3) {
            console.log('insufficient scopes')
        }
        router.post('/portal/update', processPassback)
        controller.middleware.receive.use(processIncomingMessage)
        await initiateHandshake(plugin)
        console.log('portal_init_complete')
    } catch (err) {
        console.error(`portal_init_failed: ${err}`)
        throw new Error(err)
    }
}

//TODO use message encryption/hash for passback validation as with Slack
// should receive a properly-configured message for slack
const processPassback = async (req, res) => {
    try {
        plugin.controller.asyncFindTeam = promisify(plugin.controller.findTeamById)
        if (!req.headers.client_secret || req.headers.client_secret != plugin.config.client_secret) throw new Error('invalid_auth')
        if (!req.body) throw new Error('missing_data')
        let data = (_.isString(req.body)) ? JSON.parse(req.body): req.body
        let {message, team_id, type, hash} = data
        if (!message || !team_id || !hash) throw new Error('missing_data')
        let team = await plugin.controller.asyncFindTeam(team_id)
        if (!team) throw new Error('cannot_get_team')
        let bot = plugin.controller.spawn(team)
        bot.async = promisifyAPI(bot.api) // for sanity
        message.token = bot.config.token || bot.config.bot.token
        let response
        switch (type) {
            case 'response':
                response = await bot.async.chat.postMessage(message)
                break;
            case 'update':
                response = await bot.async.chat.update(message)
        }
        res.status(200).json({status: 'ok', hash: data.hash || 'none'})
    } catch (err) {
        try {
            let status = 400
            if (_.includes(['invalid_auth'],err.message)) status = 401
            res.status(status).json({status:'fail', message: err.message})
        } catch (err) {
            console.log(`failed to send res: ${err}`)
        }
    }   
}



const processIncomingMessage = async (bot, message, next) => {
    try {
        let list = 'direct_message,direct_mention,block_actions,view_submission,view_closed,message_deleted,message_changed,message_action,slash_command'.split(',')
        if (!list.includes(message.type)) return next()
        bot.async = promisifyAPI(bot.api) // for sanity
        console.log(`this is a portal message: ${message.type}`)
        switch (message.type) {
            case 'direct_message': //check if dm is a convo
                return handleDirectMessage(bot, message, next)
            case 'message_changed'://TODO later
                if (message.edited.user == bot.config.bot_id) return;
                return next();
            case 'message_deleted'://TODO later
                if (message.authed_users.includes(bot.config.bot_id)) return;
                return next();
            // case 'app_mention':
            // case 'mention':
            case 'direct_mention':
                return handleMention(bot, message, next)
            case 'block_actions':
                let blockAction = message.actions[0].action_id
                if (!blockAction.startsWith('action_portal_')) return next()
                let [action, type]  = blockAction.replace('action_portal_','').split(':')
                if (message.text == 'null') message.text = null
                switch (action) {
                    case 'cancel':
                        if (message.response_url) {
                            bot.replyInteractive(message, {delete_original:true}, (err, resp) => {
                                if (err) console.log(`Failed to delete menu: ${err}`)
                            })
                        }
                        return
                    case 'send':
                        message.portal_data = await get_portal_data(message, bot)
                        message.portal_data.type = 'new'
                        message.portal_data.request_type = type || 'support'
                        message.portal_data.ticket_id = create_ticket_id(message, bot)
                        return sendNewTicketToPortal(bot, message, next)
                    case 'launch':
                        message.modal_content = message.text
                        message.ts = message.container.message_ts
                        message.action_type = type || 'support'
                        return launchSupportModal(bot, message, next)
                    default:
                        return next()
                }
            case 'view_closed':
                if (! message.view.callback_id.startsWith('action_portal_')) return next()
                bot.replyAcknowledge()
                //save/send stats
                return next()
            case 'view_submission':
                if (! message.view.callback_id.startsWith('action_portal_')) return next()
                let [user,channel,ts,sub_type, response_url] = message.view.private_metadata.split('_')
                let inputs = _.values(message.view.state.values)[0]
                if (!validateModal(bot, inputs)) return next()
                message.channel = channel
                message.ts = ts
                message.user = user
                message.response_url = response_url
                message.portal_data = await get_portal_data(message, bot)
                message.portal_data.ticket_id = create_ticket_id(message, bot)
                message.portal_data.type='new'
                message.text = inputs.input_text.value
                message.portal_data.request_type = inputs.input_type || sub_type || 'support'
                let result = await sendNewTicketToPortal(bot, message, next)
                bot.replyAcknowledge()
                break;
            case 'message_action':
                if (! message.callback_id || !message.callback_id.startsWith('action_portal_')) return next()
                let [m_action, m_type]  = message.callback_id.replace('action_portal_','').split(':')
                switch (m_action) {
                    case 'launch':
                        message.modal_content = message.message.text
                        message.ts = message.message_ts
                        message.action_type = m_type || 'support'
                        return launchSupportModal(bot, message, next)
                    default:
                        return next()
                }
            case 'slash_command': // slash is always a nightmare
                bot.replyAcknowledge()
                let commands = plugin.config.listeners.slash_command || null
                let keyList = plugin.config.listeners.keywords || []
                if (!commands && keyList.length <=0) return next() // nothing specified to catch
                if (message.text == 'null') message.text = null
                let command = message.command.slice(1) //drop first slash
                let commandList = commands[command] || []
                let [keyword, ...remainder] = (message.text != null) ? message.text.split(' ') : [null, null]
                remainder = (remainder) ? remainder.join(' ').trim() : remainder
                if (remainder.length <= 0) remainder = null
                let has_command = (commands) ? _.includes(_.keys(commands), command) : false
                let in_commandList = _.includes(commandList, keyword)
                let in_keyList = _.includes(keyList, keyword)
                // !!! if there's a command, and no command list, it goes
                // commandList means there's a command, and a list - reject no keyword match. 
                message.modal_content = message.text
                message.action_type = 'support'
                if (commandList.length > 0){
                    if (!in_commandList) return next()
                    message.modal_content = remainder
                    message.action_type = keyword
                } else if (!has_command) {
                    // if there's no command match, no keylist, or no key match, then reject
                    if (!in_keyList) return next()
                    message.modal_content = remainder
                    message.action_type = keyword
                }
                bot.replyAcknowledge()
                message.ts = 'slash'
                return launchSupportModal(bot, message, next)
            default:
                return next()
        }
    } catch (err) {
        console.log(err)
        next()
    }
}

//STUB
const validateModal = (bot, inputs) => {
    return true
}

const sendNewTicketToPortal = async (bot, message, next) => {
    try {
        let ticket = templates.new_support_ticket(message, message.portal_data.ticket_id)
        ticket.token = bot.config.token || bot.config.bot.token
        let im = await bot.async.conversations.open({users: message.user.id || message.user, token: ticket.token})
        ticket.channel = im.channel.id
        let new_msg = await bot.async.chat.postMessage(ticket)
        new_msg.token = ticket.token
        new_msg.message_ts = new_msg.ts
        message.portal_data.permalink = await bot.async.chat.getPermalink(new_msg)
        bot.replyInteractive(message, {delete_original:true}, (err, resp) => {
            if (err) console.log(`Failed to delete menu: ${err}`)
        })
        await sendToPortal(message)
        if (plugin.no_passthrough) return
        return next()
    } catch (err) {
        console.log(`portal_send_ticket_failed: ${err}`)
    }
    return next()
}

const launchSupportModal = async (bot, message, next) => {
    try{
        if (!message.trigger_id) return next()
        let view = templates.support_modal(message.modal_content|| null)
        //TODO just serialize an object already
        view.private_metadata = `${message.user.id||message.user}_${message.channel}_${message.ts}_${message.action_type}_${message.response_url||null}`
        view.callback_id = plugin.callback_id
        let data = {
            trigger_id: message.trigger_id,
            token: bot.config.token || bot.config.bot.token,
            view
        }
        // console.log(JSON.stringify(view, null, 2))
        let result = await bot.async.views.open(data)
        if (plugin.no_passthrough) return result
    } catch (err) {
        console.log(`Failed to publish portal modal: ${err}`)
    }
    return next()
}

// TODO add logic for dealing with a mid/end-message @mention
const handleMention = async (bot, message, next) => {
    let listeners = plugin.config.listeners
    if (!listeners.at_mention) return next()
    let dm_text = message.text.split(' ')
    let first = dm_text.shift() || ''
    if (typeof listeners.at_mention != 'boolean') {
        if (!first || first.length <=0) return next()
        if (!listeners.at_mention.includes(first)) return next()
        dm_text = dm_text.join(' ').trim()
    } 
    else if (listeners.keywords.includes(first)) {
        dm_text = dm_text.join(' ').trim()
    } else {
        first = null
        dm_text = message.text.trim()
    }
    let dm_ephemeral = templates.dm_response(first, dm_text || null)
    dm_ephemeral.token = bot.config.token
    dm_ephemeral.channel = message.channel
    dm_ephemeral.user = message.user
    try {
        let resp = await bot.async.chat.postEphemeral(dm_ephemeral)
    } catch (err) {
        console.log(err)
    }
    if (plugin.no_passthrough) return
    return next()
}

const handleDirectMessage = async (bot, message, next) => {
    let portal_data = await get_portal_data(message, bot)
    // TODO allow any @mention of the bot, swap to direct_mention
    if (message.event.text && message.event.text.startsWith(`<@${bot.config.bot_id}`)) {
        message.type = 'direct_mention'
        return processIncomingMessage(bot, message, next)
    }
    if (isParentMessage(message)) {
        //check for a DM @message
        return next()
    }
    let ticket_id = await get_ticket_id(message, bot)
    if (!ticket_id) return next() // not messing with non-support threads
    portal_data.ticket_id = ticket_id
    portal_data.type = 'response'
    message.portal_data = portal_data
    response = await sendToPortal(message)
    if (plugin.no_passthrough) return // cut off middleware
    next()
}


const get_portal_data = async (message, bot) => {
    let data = {
        user_id: message.user.id || message.user,
        client_id: bot.config.id,
        callback_url: plugin.config.receiver_url
    }
    try {
        let token = bot.config.token || bot.config.bot.token
        let team_promise = bot.async.auth.test({token})
        let user_promise = bot.async.users.info({token, user: data.user_id})
        let user = await user_promise
        let team = await team_promise
        data.client_name = team.team
        data.client_url = team.url
        data.user_name = user.user.real_name || user.user.name || null
    } catch (err) {
        console.log(`error getting portal data: ${err}`)
    }
    return data
}


// OK, we're creating ids that are passed to portal main. 
// If the parent is created by us, there'll be a ticket id embedded
// Really, tickets are only created by dialog so far (?)
//  - if we choose to allow in-situ tickets, we'll need to rethink this (maybe first child thread?)
// if not: 
//  1) it's a thread of a ticket - check the parent for an id
//  2) it's a new parent ticket - handle this separately
//  3) it's a thread of a non-ticket, or ambient dm. ignore.
const get_ticket_id = async (message, bot) => {
    if (message.ticket_id) return message.ticket_id
    try {
        if (message.blocks) {
            let id_block = _.find(message.blocks, (i) => 'block_id' in i && i.block_id.startsWith('portal_ticket:'))
            if (id_block) return id_block.block_id
        }
        if (!isParentMessage(message)) {
            let parent = await bot.async.conversations.history({
                token: bot.config.token,
                channel: message.channel,
                latest: message.thread_ts,
                limit:1,
                inclusive:true
            })
            return get_ticket_id(parent.messages[0])
        }
    } catch (err) {
        return null
    }
}

//TODO - if this is deterministic, then I don't have to embed ticket ids.
const create_ticket_id = (message, bot) => {
    return `portal_ticket:${message.team.id || message.team}_${bot.config.id}_${random.generate()}`
}

function isParentMessage(message) {
    return (!message.thread_ts || message.thread_ts == message.ts)
}

// TODO have this trigger a check on the receiver route, verify that plugin functions
async function initiateHandshake(plugin) {
    let data = {
        // add data on host app for id? app_user_id/app_name?
    }
    let post_headers = { 
        content_type: 'application/json',
        portal_token: plugin.config.portal_token
    }
    let handshake = await axios.post(`${plugin.portal_url}/portal/init`, data, {headers: post_headers})
    if (handshake.status == 200) {
        if (!handshake.headers.client_secret || handshake.headers.client_secret != plugin.config.client_secret) {
            throw new Error('response_auth_invalid')
        } else {
            console.log('handshake complete')
        }
    } else {
        throw new Error(`handshake_failed: ${handshake.status}`)
    }
}

// structure message w/ portal data prior to passing
const sendToPortal = async (message) => {
    let post_headers = { 
        content_type: 'application/json',
        portal_token: plugin.config.portal_token
    }
    let resp = await axios.post(`${plugin.portal_url}/portal/intake`, message, {headers: post_headers})
    if (resp.status == 200) {
        if (!resp.headers.client_secret || resp.headers.client_secret != plugin.config.client_secret) {
            throw new Error('response_auth_invalid')
        } else if (resp.data.status !== 'ok') {
            throw new Error(`portal_call_failed: ${resp.data.message || 'unknown_failure'}`)
        } else if (resp.data.ticket_id != message.portal_data.ticket_id) {
            throw new Error('portal_incorrect_data')
        } else {
            return resp.data.ticket_id
        }
    } else {
        throw new Error(`portal_intake_call_failed: ${resp.status}`)
    }

}

function verifyPassback(req) {
    const originURL = req.protocol + '://' + req.get('host')
    if (!originURL != plugin.config.portal_url) return false
    return (req.headers.token && req.headers.token == plugin.config.client_secret)
}

// function hashWorkspaceId(id) {
//     return workspace_id
// }
// function getUsage(plugin) {
//     try {
//         return btoa.encode(JSON.stringify(plugin.usage))
//     } catch (err) {
//         return 'usage_stats_failed'
//     }
// }
// function logUsage(plugin, message) {
//     let id = hashWorkspaceId(message.workspace_id)
//     plugin.usage.workspaces[id] = moment().unix()
//     let type = null
//     switch (message.type) {
//         case 'slash_command':
//             type = 'slash'
//             break;
//         case `message_action`:
//             type = 'm_action'
//             break;
//         case `block_actions`:
//             type = 'b_action'
//             break;
//         case 'mention':
//         case 'direct_mention':
//             type = 'dm'
//             break;
//         case 'view_submission':
//         case 'view_closed':
//             type = 'modal'
//             break;
//         default:
//             break;
//     }
//     plugin.usage[type].t += 1
//     if (message.type == 'view_closed') {
//         if (message.is_cleared) plugin.usage[type].tc +=1
//         else plugin.usage[type].tx +=1
//     }
//     if (message.is_portal) {
//         plugin.usage[type].p += 1
//         if (message.type == 'view_closed') {
//             if (message.is_cleared) plugin.usage[type].pc +=1
//             else plugin.usage[type].px +=1
//         }
//     }

// }

function setupUsageTracker(plugin) {
    plugin.usage = {
        workspaces: {}, //need # workspaces for billing/compare w/active users
        slash: {t: 0, p: 0}, 
        m_action: {t: 0, p: 0},
        b_action: {t: 0, p: 0},
        dm: {t: 0, p: 0},
        im: {t: 0, p: 0},
        modal: {t: 0, tx: 0, tc:0, p: 0, px:0, pc:0} //track modal closures and cancels
    }
    // plugin.logUsage = (message) => logUsage(plugin, message)
    // plugin.getUsage = () => getUsage(plugin)
}


//takes an object/collection and recursively promisifies all down-tree functions.
const promisifyAPI = (obj) => {
    if(_.isFunction(obj)) return promisify(obj)
    if(!_.isObject(obj) || _.isString(obj)) return obj;//not an obje
    _.forOwn(obj, (element, key) => {
        obj[key] = promisifyAPI(element)
    })
    return obj
}

module.exports = BotkitPortalPlugin