console.log('loading_templates')
const _ = require('lodash')
const { block, element, object, view, TEXT_FORMAT_MRKDWN } = require('slack-block-kit')
const { text, confirm, option, optionGroup, optionGroups, plainTextInput } = object
const {  
    button, overflow, staticSelect, externalSelect, 
    usersSelect, conversationsSelect, channelsSelect,
    datePicker
  } = element

const { section, actions, divider, context, image, input } = block

module.exports = {

    new_support_ticket: (message, ticket_id, add_context=false) => {
        let type = message.portal_data.request_type
        type = type.charAt(0).toUpperCase() + type.slice(1)

        let header_block = section(text(`*Your ${type} Request:*`, TEXT_FORMAT_MRKDWN),{ block_id: `${ticket_id}` })
        let message_block = section(text(`>${message.text}`, TEXT_FORMAT_MRKDWN),{ block_id: `ticket_message`})

        // let edit_button = button(action_id, text_value, {url, value, confirm, style})
        let edit_action = button( `edit_ticket:${ticket_id}`, 'Edit Request', 
            { value: `${message.text}`, confirm: true, style: 'primary' }
        )

        let blocks = [header_block, message_block]
        if (false) blocks.push(edit_action)

        return {
            text: message.text,
            blocks
        }
    },

    // ignoring select until we have the rest worked out
    support_modal: (text, metadata) => {

        // let input_block = (actionId, {placeholderText, initialValue, multiLine, minLength, maxLength})
        let input_params = {
            placeholderText: `Enter your support request here`,
            multiline: true,
            minLength: 3
        }

        if (text) input_params.initial_value = text
        let input_element = plainTextInput('input_text', input_params)

        let input_block = input(`Feel free to send us a question, concern, or other feedback in the field below. Thanks!`, input_element, {
            // hintText, blockId
        })

        let options = [
            option('Support','support'),
            option('Feedback','feedback'),
            option('Help','help')
        ]
        let type_select_block = input('Select a report type:', staticSelect('input_report_type', 'Request Type', options, {
            initialOption: option('Support','support')
        }))

        let blocks = [ input_block ]

        let report_modal = view.modal('Contact Support', blocks, {
            closeText: 'Cancel',
            submitText: 'Submit Request',
            privateMetadata: metadata,
            // callbackId: 'my-callback-id',
            clearOnClose: true,
            notifyOnClose: true,
            // externalId: 'unique-external-id',
        })

        return report_modal
    },

    dm_response: (keyword=null, text=null, type='support') => {
        let message_text = `Hi! Do you want to`
        if (keyword) {
            message_text = `Hi :wave: We heard you say \`${keyword}\` - do you want to`
            edit_text = 'Send Request'
        }
        if (text) message_text += ` send the following support request to our team?`
        else message_text += ` open a new support request?`

        let blocks = [section(text(message_text, TEXT_FORMAT_MRKDWN))]
        if (text) blocks.push(section(text(`>${text}`,TEXT_FORMAT_MRKDWN)))

        let msg_actions = [
            button('action_portal_cancel', 'Cancel', {value=`${text||'no_msg'}`})//always cancel opt
        ]

        let create_btn = button(`action_portal_launch:${type||'support'}`, 'Open New Request', {value:`${text||'no_msg'}`, style:'primary'})
        let edit_btn = button(`action_portal_launch:${type||'support'}`, 'Edit Request', {value:`${text||'no_msg'}`, style:'primary'})
        let submit_btn = button(`action_portal_send:${type||'support'}`, 'Send Request', {value:`${text||'no_msg'}`})

        if (text) {
            _.concat(msg_actions, edit_btn, submit_btn)
        } else {
            msg_actions.push(create_btn)
        }

        let action_block = actions(msg_actions, {blockId: 'portal_action'})

        blocks.push(action_block)
        
        return {
            text: message_text,
            blocks
        }
    }
}