const _ = require('lodash')
const axios = require('axios')
const random = require('randomstring')
const { promisify } = require('es6-promisify')
const templates = require('./slack_templates')
const crypto = require('crypto')

let plugin

const BotkitPortalPlugin = (config) => {
    plugin = {
        name: 'Slack Portal Plugin',
        config: config
    }

    if (config.controller) plugin.controller = config.controller
    if (!config.receiver_url) throw new Error(`receiver_url missing: Need Slack app base URL to recieve validate incoming responses from the Portal app`)
    if (!config.portal_token) throw new Error(`config.portal_token missing: Need an authentication token from the Portal app`)
    if (!config.client_secret) throw new Error(`config.client_token missing: Need a client verification token to validate incoming responses from the Portal app`)
    // This adds default listeners - will listen for: 
    //  - `/<your-slash-command> [support|help|helpdesk|feedback], 
    //  - /[support|help|helpdesk|feedback] if you set any of them up as available slash commands in your app
    //  - an @mention of your app with [support|help|helpdesk|feedback] as a keyword: e.g.: @<your bot> support [user text here]
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
    return plugin
}

const init = async(controller) => {
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

const processPassback = async (req, res) => {
    try {
        plugin.controller.asyncFindTeam = promisify(plugin.controller.findTeamById)
        // if (!validatePassback(req)) throw new Error('invalid_auth')
        if (!req.headers.client_secret || req.headers.client_secret != plugin.config.client_secret) throw new Error('invalid_auth')
        if (!req.body && !req.data) throw new Error('missing_data')
        let data = (req.body) ? req.body : req.data
        data = (_.isString(data)) ? JSON.parse(data): data
        if (!data.portal_data || !data.portal_data.ticket_id) throw new Error('missing_data')
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
        response.message.channel = response.channel
        res.set({token: team.portal_token})
        res.status(200).json({status: 'ok', message: response.message})
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

handleMessageAction = utlis.handleMessageAction


const processIncomingMessage = async (bot, message, next) => {
    try {
        let list = 'direct_message,direct_mention,block_actions,view_submission,view_closed,message_deleted,message_changed,message_action,slash_command'.split(',')
        if (!list.includes(message.type)) return next()
        bot.async = promisifyAPI(bot.api) // for sanity
        console.log(`this is a portal message: ${message.type}`)
        switch (message.type) {
            case 'direct_message':
                return handleDirectMessage(bot, message, next)
            case 'message_changed':
                return handleMessageUpdate(bot, message, next)
            case 'message_deleted':
                return handleDeletedMessage(bot, message, next)
            case 'direct_mention':
                return handleMention(bot, message, next)
            case 'block_actions':
                return handleBlockAction(bot, message, next)
            case 'view_closed':
                if (! message.view.callback_id.startsWith('action_portal_')) return next()
                bot.replyAcknowledge()
                // TODO save/send stats
                return next()
            case 'view_submission':
                return handleViewSubmission(bot, message, next)
            case 'message_action':
                return handleMessageAction(bot, message, next)
            case 'slash_command': 
                return handleSlashCommand(bot, message, next)
            default:
                return next()
        }
    } catch (err) {
        console.log(`portal_receive_middleware_failure: ${err}`)
        next()
    }
}

const handleMessageUpdate = async (bot, message, next) => {
    if (!message.message.edited || (message.message.edited && message.message.edited.user == bot.config.bot.id)) return;
    if (message.team == bot.config.id && _.includes(_.values(bot.config.channels), message.channel)) return next() // this is messing stuff up a bit.
    message.previous_message.channel = message.channel
    let ticket_id = await get_ticket_id(message.previous_message, bot)
    if (!ticket_id) return next() //no ticket referenced
    message.portal_data = await get_portal_data(message.message, bot)
    message.portal_data.type = 'update'
    message.portal_data.ticket_id = ticket_id
    return sendToPortal(message)
}


// TODO add logic for dealing with a mid/end-message @mention
const handleMention = async (bot, message, next) => {
    let listeners = plugin.config.listeners
    if (!listeners.at_mention) return next()
    let dm_text = message.text.split(' ')
    let first = dm_text.shift().toLowerCase() || ''
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
    try {
        let portal_data = await get_portal_data(message, bot)
        // TODO allow any @mention of the bot, swap to direct_mention
        if (message.event.text && message.event.text.startsWith(`<@${bot.config.bot_id}`)) {
            message.type = 'direct_mention'
            return processIncomingMessage(bot, message, next)
        }
        if (isParentMessage(message)) return next()
        let ticket_id = await get_ticket_id(message, bot)
        if (!ticket_id) return next()
        portal_data.ticket_id = ticket_id
        portal_data.type = 'response'
        message.portal_data = portal_data
        response = await sendToPortal(message)
        if (plugin.no_passthrough) return 
        next()
    } catch (err) {
        console.log(`direct_message_failed: ${err}`)
    }
}

const handleDeletedMessage = async (bot, message, next) => {
    let deletedTicketId = await get_ticket_id(message, bot)
    if (!deletedTicketId) return next()
    message.user = ''
    message.portal_data = {
        ticket_id: deletedTicketId,
        type: 'delete'
    }
    await sendToPortal(message)
    if (plugin.no_passthrough) return
    return next();
}

const get_portal_data = async (message, bot) => {
    let data = {
        user_id: (_.isObject(message.user)) ? message.user.id : message.user,
        client_id: bot.config.id,
        callback_url: plugin.config.receiver_url
    }

    try {
        let token = bot.config.token || bot.config.bot.token
        let team_promise = bot.async.auth.test({token})
        let user_promise = bot.async.users.info({token, user: data.user_id})
        let team = await team_promise
        data.client_name = team.team
        data.client_url = team.url
        let user = await user_promise
        data.user_name = user.user.real_name || user.user.name || null
    } catch (err) {
        console.log(`error getting portal data: ${err}`)
    }
    return data
}

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

const create_ticket_id = (message, bot) => {
    return `portal_ticket:${bot.config.id|| message.team.id || message.team}_${message.channel}_${random.generate()}`
}

function isParentMessage(message) {
    return (!message.thread_ts || message.thread_ts == message.ts)
}

// TODO have this trigger a check on the receiver route, verify that plugin functions
// TODO have this pass templates for processing - make updates easier
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
        }
        console.log('handshake complete')
    } else {
        throw new Error(`handshake_failed: ${handshake.status}`)
    }
}

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

// TODO not implemented
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

// TODO Uses validation process similar to Slack client signing
const validatePassback = (req) => {
    try {
        let timestamp = req.header('X-Portal-Request-Timestamp');
        if (!body) throw new Error('no_timestamp')
        let signature = req.header(`X-Portal-Signature`)
        if (!body) throw new Error('no_signature')
        let body = req.rawBody
        let version = signature.split('=')[0]
        if (!body) throw new Error('no_raw_request_data')
        let basestring = `${version}:${timestamp}:${body}`
        const base = crypto.createHmac('sha256', plugin.config.client_secret).update(basestring).digest('hex')
        const hash = `${version}=${base}`

        const validSignature = () => {
            const slackSigBuffer = new Buffer(retrievedSignature);
            const compSigBuffer = new Buffer(hash);
            return crypto.timingSafeEqual(slackSigBuffer, compSigBuffer);
        }
        return validSignature()
    } catch (err) {
        console.log(`incoming_portal_validation_failed: ${err.message}`)
        return false
    }
}

//STUB - use later if we want to add modal validation params
const validateModal = (bot, inputs) => {
    return true
}


module.exports = BotkitPortalPlugin