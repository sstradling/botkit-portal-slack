let templates = require('./slack_templates')
let _ = require('lodash')
let core = require('../core/core')


module.exports = {
    launchSupportModal,
    sendNewTicketToPortal
    getPortalData,
    createTicketId

}

const launchSupportModal = async (bot, message, next) => {
    try{
        if (!message.trigger_id) return next()
        metadata = `${message.user.id||message.user}_${message.channel}_${message.ts}_${message.action_type}_${message.response_url||null}`
        let view = templates.support_modal(message.modal_content|| null, metadata, plugin.callback_id)
        //TODO just serialize an object already!
        // view.private_metadata = 
        // view.callback_id = plugin.callback_id
        let data = {
            trigger_id: message.trigger_id,
            token: bot.config.token || bot.config.bot.token,
            view
        }
        // console.log(JSON.stringify(data, null, 2))
        let result = await bot.async.views.open(data)
        if (plugin.no_passthrough) return result
    } catch (err) {
        console.log(`Failed to publish portal modal: ${err}`)
    }
    return next()
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
        message.ts = new_msg.ts
        message.channel = new_msg.channel
        message.portal_data.permalink = await bot.async.chat.getPermalink(new_msg)
        // TODO have this update the ephemeral msg if sendToPortal fails for some reason
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
