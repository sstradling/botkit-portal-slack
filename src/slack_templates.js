console.log('loading_templates')
const _ = require('lodash')
module.exports = {

    new_support_ticket: (message, ticket_id) => {
        let type = message.portal_data.request_type
        type = type.charAt(0).toUpperCase() + type.slice(1)
        let blocks = [
            {
                type: "section",
                block_id: `${ticket_id}`,
                text: {
                    type: "mrkdwn",
                    text: `*Your ${type} Request:*`
                }
            },
            {
                type: "section",
                block_id: "ticket_message",
                text: {
                    type: "mrkdwn",
                    text: `>${message.text}`
                }
            }
        ]
        return {
            text: message.text,
            blocks
        }
    },

    // ignoring select until we have the rest worked out
    support_modal: (text) => {
        let input = {
            type: "plain_text_input",
            multiline: true,
            placeholder: {
                type: "plain_text",
                text: "Enter your support request here",
                emoji: true
            },
            action_id: "input_text"
        }
        if (text) input['initial_value'] = text

        let view = {
            notify_on_close: true,
            type: "modal",
            title: {
                type: "plain_text",
                text: `Contact Support`,
                emoji: true
            },
            submit: {
                type: "plain_text",
                text: "Submit Request",
                emoji: true
            },
            close: {
                type: "plain_text",
                text: "Cancel",
                emoji: true
            },
            blocks: [
                {
                    type: "input",
                    element: input,
                    label: {
                        type: "plain_text",
                        text: "Feel free to send us a question, concern, or other feedback in the field below. Thanks!",
                        emoji: true
                    }
                }
            ]
        }
        return view
    },

    dm_response: (keyword=null, text=null) => {
        let message_text = `Hi! Do you want to`
        if (keyword) {
            message_text = `Hi :wave: We heard you say \`${keyword}\` - do you want to`
            edit_text = 'Send Request'
        }
        if (text) message_text += ` send the following support request to our team?`
        else message_text += ` open a new support request?`
        let blocks = [{
            type: "section",
            text: {
                type: "mrkdwn",
                text: message_text
            }
        }]

        if (text) blocks.push({ // maybe add divider?
            type: "section",
            text: {
                type: "mrkdwn",
                text: `>${text}`
            }
        })
        let actions = {
			type: "actions",
			block_id: "portal_action"
        }

        let no = {
            type: "button",
            text: {
                type: "plain_text",
                text: "Cancel",
                emoji: true
            },
            value: `${text}`,
            action_id: "action_portal_cancel"
        }

        let edit = {
            type: "button",
            style: "primary",
            text: {
                type: "plain_text",
                text: "Edit Request",
                emoji: true
            },
            value: `${text}`,
            action_id: "action_portal_launch:support"
        }
        
        let yes = {
            type: "button",
            // style: "primary",
            text: {
                type: "plain_text",
                text: "Send Request",
                emoji: true
            },
            value: `${text}`,
            action_id: "action_portal_send:support"
        }

        actions.elements = [no, edit]

        if (!text) edit.text.text = 'Open New Request'
        else actions.elements.push(yes)
        blocks.push(actions)
        return {
            text: message_text,
            blocks
        }
    }
}