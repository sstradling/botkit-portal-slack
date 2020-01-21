let core = require('../core/core')
let utils = require('./utils')
let _ = require('lodash')
module.exports = (u) => {

    u.handleMessageAction = (bot, message, next ) => {
        if (! message.callback_id || !message.callback_id.startsWith('action_portal_')) return next()
        let [m_action, m_type]  = message.callback_id.replace('action_portal_','').split(':')
        switch (m_action) {
            case 'launch':
                message.modal_content = message.message.text
                message.ts = message.message_ts
                message.action_type = m_type || 'support'
                return utils.launchSupportModal(bot, message, next)
            default:
                return next()
        }
    }

    u.handleSlashCommand = (bot, message, next) => {
        bot.replyAcknowledge()
        let commands = plugin.config.listeners.slash_command || null
        let keyList = plugin.config.listeners.keywords || []
        if (!commands && keyList.length <=0) return next() // nothing specified to catch
        if (message.text == 'null') message.text = null
        let command = message.command.slice(1) //drop first slash
        let commandList = commands[command] || []
        let [keyword, ...remainder] = (message.text != null) ? message.text.split(' ') : [null, null]
        keyword = keyword.toLowerCase().trim()
        remainder = (remainder) ? remainder.join(' ').trim() : remainder
        if (remainder.length <= 0) remainder = null
        let has_command = (commands) ? _.includes(_.keys(commands), command) : false
        let in_commandList = _.includes(commandList, keyword)
        let in_keyList = _.includes(keyList, keyword)
        message.modal_content = message.text
        message.action_type = 'support'
        if (commandList.length > 0){
            if (!in_commandList) return next()
            message.modal_content = remainder
            message.action_type = keyword
        } else if (!has_command) {
            if (!in_keyList) return next()
            message.modal_content = remainder
            message.action_type = keyword
        }
        message.ts = 'slash'
        return utils.launchSupportModal(bot, message, next)
    }

    u.handleBlockAction = async (bot, message) => {
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
                message.portal_data = await utils.getPortalData(message, bot)
                message.portal_data.type = 'new'
                message.portal_data.request_type = type || 'support'
                message.portal_data.ticket_id = utils.createTicketId(message, bot)
                return core.sendNewTicketToPortal(bot, message, next)
            case 'launch':
                message.modal_content = message.text
                message.ts = message.container.message_ts
                message.action_type = type || 'support'
                return utils.launchSupportModal(bot, message, next)
            default:
                return next()
        }
    }


    u.handleViewSubmission = async (bot, message, next) => {
        if (! message.view.callback_id.startsWith('action_portal_')) return next()
        bot.replyAcknowledge()
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
        // TODO send an ephemeral message to update or notify if things go wrong
        return
    }

}