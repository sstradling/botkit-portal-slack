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
                    text: `*Your ${type} Request:*`// ${trunc}`
                }
            },
            {
                type: "section",
                block_id: "ticket_message",
                text: {
                    type: "mrkdwn",
                    text: `>${message.text}`
                }
            },
            // {
            //     type: "actions",
            //     block_id: "portal_edit_action",
            //     elements: [{
            //         type: "button",
            //         style: "primary",
            //         text: {
            //             type: "plain_text",
            //             text: "Edit Request",
            //             emoji: true
            //         },
            //         value: `${message.text}`,
            //         action_id: `edit_ticket:${message.portal_data.ticket_id}`
            //     }]
            // },
            // {
            //     type: "context",
            //     elements: [
            //         {
            //             type: "mrkdwn",
            //             text: "*Last Updated:* ${timestamp}: ${user}"
            //         }
            //     ]
            // }
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
                text: `Contact Support`, // TODO allow bot name
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
                // {
                //     type: "input",
                //     element: {
                //         action_id: "input_type",
                //         type: "static_select",
                //         placeholder: {
                //             type: "plain_text",
                //             text: "Request type",
                //             emoji: true
                //         },
                //         options: [
                //             {
                //                 text: {
                //                     type: "plain_text",
                //                     text: "Support",
                //                     emoji: true
                //                 },
                //                 value: "support"
                //             },
                //             {
                //                 text: {
                //                     type: "plain_text",
                //                     text: "Feedback",
                //                     emoji: true
                //                 },
                //                 value: "feedback"
                //             },
                //             {
                //                 text: {
                //                     type: "plain_text",
                //                     text: "Help!",
                //                     emoji: true
                //                 },
                //                 value: "help"
                //             }
                //         ]
                //     },
                //     label: {
                //         type: "plain_text",
                //         text: "Select a request type",
                //         emoji: true
                //     }
                // }
            ]
        }
        return view

    },
    dm_response: (keyword=null, text=null) => {
        // builds an ephemeral message that asks if
        // 1) you'd like to send the text directly to the app publisher, or
        // 2) you'd like to edit it and send it, or
        // 3) you don't want to send anything
        let message_text = `Hi! Do you want to`
        let edit_text = 'Open New Request'
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
        // blocks.push({type: "divider"})
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