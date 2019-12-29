/**
 * @module botkit-portal-slack
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { SlackBot } from 'botkit_legacy'
import axios, { AxiosRequestConfig, AxiosPromise } from 'axios';
import _ = require('lodash')
import moment = require('moment');
import btoa = require('base-64')
import { createCipheriv, randomBytes } from 'crypto'
import random = require('randomstring');

export class BotkitLegacyPortalPlugin {

    private __config: any
    private __controller: SlackBot
    private __is_legacy: boolean
    private __receiver_url: string
    private __listener_url: string
    private __usage: any
    private __passthrough: boolean

    public name: string = 'Slack Portal Plugin'
    private LISTENER_URL: string = 'https://app.portalforslack.com' 
    private PORTAL_CALLBACK_ID: string = 'action_portal_launch'

    /**
     * config should include:
     *   - botkit controller, 
     *   - reciever_url; the url your bot is hosted at,
     *   - portal_token: the auth token you'll recieve from Portal
     *   - client_token: signing secret for verifying messages from portal - same process as with slack
     *   - [optional] listeners: <defaults defined below>
     *      - at_mention []: if you have a term or terms that should activate a modal from an at_mention (like <at>bot help, <at>bot support)
     *      - slash_command []: any specific slash command or command-term sequence that portal should listen for (/help, /bot help, /bot feedback, etc)
     *          - defaults to /[bot] support [text] and /[bot] feedback
     *   - [optional] actions: [] callback ids we should listen for to launch a support modal
     * 
     * @param config 
     */
    public constructor(config: any) {
        if (config.controller) {
            this.process_controller(config.controller)
        }
        if (! config.receiver_url) {
            throw new Error('config.receiver_url missing: Need Slack app base URL to recieve validate incoming responses from the Portal app') //there's a reciever url???
        }
        if (! config.portal_token) {
            throw new Error('config.portal_token missing: Need an authentication token from the Portal app')
        }
        if (! config.client_secret) {
            throw new Error('config.client_token missing: Need a client verification token to validate incoming responses from the Portal app')
        }
        // TODO Add a modal/dialog listener to directly handle existing dialogs
        if (! config.listeners) {
            let keywords = ['support','help','helpdesk','feedback']
            config.listeners = {
                keywords,
                slash_command: {
                    feedback: null, // null captures all text after /feedback
                    support: null,
                    help: null,
                    helpdesk: null
                },
                at_mention: keywords
            }
            //create default listeners if nothing passed
        }
        this.__receiver_url = config.receiver_url
        this.__listener_url = config.listener_url ? config.listener_url : this.LISTENER_URL
        
        if (config.passthrough) {
            this.__passthrough = config.passthrough
        } else {
            this.__passthrough = true
        }
        if (!config.callback_id) {
            config.callback_id = this.PORTAL_CALLBACK_ID
        }
        this.__config = config;
    }

    /**
     * 
     * @param botkit : requires an initialized botkit instance
     */
    public init(botkit: SlackBot): void {
        this.process_controller(botkit)
        // @ts-ignore webserver exists if bot is running
        const router = this.__config.webserver ? this.__config.webserver : botkit.webserver
        if (!router) throw new Error('no_webserver_defined')

        // @ts-ignore - scopes should be present
        let scopes = botkit.config.scopes ? botkit.config.scopes : []
        if (!_.isArray(scopes)) scopes = scopes.split(',')
        if (! _.includes(scopes, 'bot') || _.every(scopes, (s) => ['im:history','im:write','im:read'].includes(s))){
            throw new Error('needs_im_scopes')
        }
        // TODO handshake with portal to verify operation/use JWT instead of hard token?
        let data = {
            test: 'hi'
        }
        let headers = { 
            content_type: 'application/json',
            portal_auth_token: this.__config.portal_token
        }
        let init_resp = await axios.post(`${this.__listener_url}/portal/init`, data, {headers})
        
        // ============ adds route for handling customer => client comms (passbacks) =========

        router.post(`/portal/update`, this.process_passback)
        //@ts-ignore // this will also be present on a working system
        botkit.middleware.receive.use(this.process_incoming_message)
    }

    private isParentMessage(message: any): boolean {
        return (!message.thread_ts || message.thread_ts == message.ts)
    } 

    private async send_to_portal(data: any): Promise<void> {
        try {
            let headers = {
                token: this.__config.portal_token
            }
            let result = await axios.post(`${this.__config.listener_url}/portal/intake`, data, {headers})
            if (result.status != 200) {
                return Promise.reject()
            }
            return Promise.resolve()
        } catch (err) {
            console.log(`send_to_portal failed: ${err}`)
            return Promise.resolve()
        }
    }

    private async getParentMessage(message: any, bot: any): Promise<any> {
        if (this.isParentMessage(message)) return message
        return bot.api.conversations.history({
            token: bot.config.token,
            channel: message.channel,
            latest: message.thread_ts,
            limit: 1,
            inclusive: true
        }, (err, resp) => {
            if (err) return Promise.reject(err)
            return Promise.resolve(resp)
        })

    }
    // ===================== MESSAGE HANDLING (PRIVATE) ====================
    /**
     * 
     * @param bot 
     * @param message 
     * @param next 
     */
    private async process_incoming_message(bot: any, message: any, next: Function): Promise<void> {
        // need to add is_portal and is_cancelled to manage this one
        this.log_usage(message)
        let bot_id = bot.config.token ? bot.config.token : bot.config.bot.token
        let token = bot.config.token ? bot.config.token : bot.config.bot.token
        let ticket_id = null
        let listners = this.__config.listeners
        switch (message.type) {
            case 'direct_message': //handle DMs to the bot, allow non-ticket thread responses to pass
                if (this.isParentMessage(message)) break; // pass these along
                ticket_id = this.get_ticket_id(await this.getParentMessage(message, bot))
                if (!ticket_id) break; // no known ticket id - pass it on
                return this.handle_dm(message, bot, next)
            case 'message_changed': // got to filter this down!
                if (message.edited.user == bot_id) return; // catch echos if this bot is editing messages
                ticket_id = this.get_ticket_id(message)
                if (!this.isParentMessage(message)) {
                    try {
                        ticket_id = this.get_ticket_id(await this.getParentMessage(message, bot))
                    }
                if (!ticket_id) break;
                
                await this.handle_update(message, bot, next)
            case 'direct_mention': //ignoring 'mention' for the time being
                let first_word = message.text.split(' ').pop()
                if (!_.includes(listners.at_mention, first_word)) break;
                await this.handle_atmention(message, bot)
                if (!this.__passthrough) return
                break;
            case 'slash_command':

            // these can launch a modal, but that's about it
            case 'interactive_message_callback':
            case 'block_actions':
                if (! message.text || message.text.length() <=0) break;
                if (! message.text.startsWith(this.__config.callback_id)) break;
                // launch feedback modal
            case 'message_action':
                if (!message.callback_id.startsWith(this.__config.callback_id)) break;
            // for handling portal modal
            case 'view_closed':
            case 'view_submitted':   
        }
        next()
        switch (type) {
            // verify and get responses to ticket thread and pass on to portal
            case 'direct_message':
                // is parent - don't block other messaging interactions w/app
                if(!message.thread_ts || message.thread_ts == message.ts) return next()
                try {
                    let parent = await bot.api.conversations.history({
                        token: token,
                        channel: message.channel,
                        latest: message.thread_ts,
                        limit: 1,
                        inclusive: true
                    })
                    let ticket_id = this.get_ticket_id(parent)
                    if (ticket_id) {
                        // send message to portal.
                    }
                } catch (err) {

                }
            case 'direct_mention':
            case 'mention': 
                if (!listners.at_mention) break;
                await this.respond_atmention(bot, message)
                next()
                // probably treat the same 
                // get direct mention
                // verify that they're asking for support
                // respond with ephemeral message / block with button
                // ephemeral allows user to just send, or to edit and then send (triggers dialog)
                break;
            case 'message_action':
            case 'slash_command':
                // get message.trigger_id, launch dialog, and get the dialog response.
                break;
            case 'interactive_message_callback': // handle IM actions (legacy)
            case 'block_actions': // handle block actions
                if (!message.callback_id) return

                // ignore if not from a dialog
                if (message.view && (message.view.type == 'modal' || message.view.type == 'home')) return;
                // if message.view && message.view.type == 'home' or 'modal' handle as modal/home
                // I guess this is where you'd see updates in modal view?
                // this shouldn't mess anything up - I'm moving the support message to an IM or home page anyways.
            // case 'message_action': // handle action dropdown? doesn't seem to work
            case 'view_submission':
                bot.
                if (message.private_metadata != '???') return
                let values = message.state.values

                //validate that there's text in the text input
                let text = ''
                if (!text) {
                    bot.dialogError(
                    "response_action": "errors",
                    "errors": {
                      "ticket-due-date": "You may not select a due date in the past"
                    }
                  }
            case 'view_closed':
                // check for is_cleared flag: if cleared, user used x rather than cancel
            // ignoring these - legacy
            case 'dialog_cancellation': // would get callback_id
            case 'dialog_submission': // would get a callback_id and specified submission.* field(s)
                //ignore
                break;
        }

    }


    private async respond_atmention(bot: SlackBotWorker, message:any): Promise<void>  {
        let keywords = this.__config.listeners.at_mention
        if (!keywords || keywords.length() <=0) // continue to process
        if (!message.text || message.text.length() <= 0) // continue to process, only modal option
        if (message.type == 'direct_mention') {
            if (message.text)message.text.split(' ')[0]
        }
    }




    private get_ticket_id(message: any): String {
        if (message.ticket_id) return message.ticket_id
        try {
            let blocks = message.blocks
            let id_block = _.find(blocks, (i) => ('block_id' in i && i.block_id.startsWith('portal_ticket:')))
            if (id_block) {
                return id_block.block_id
            }
            return null
        } catch (err) {
            return null
        }

    }


    private launch_support_dialog(type:string, message:any): any {
        let dialog = new SlackDialog('title', 'callback_id', 'submit_label', ['elements'])
        dialog.addTextarea('label','name','value',{}, 'subtype') //add in text area with optional text
        dialog.addSelect('label', 'name', 'value(string|number|object', [{label: 'option_value', value:'option_value'}])
        dialog.notifyOnCancel(true)
        dialog.callback_id('')//set up 
        this.__config.replyWithDialog(dialog.asObject())
    }


    /**
     * Catches passback from customer support team and passes it to clients. POST only
     * Should contain:
     *  - portal token (from init())
     *  - hash of message and token
     *  - timestamp
     *  - actual message body
     *
     * @private
     * @memberof BotkitPortalPlugin
     */
    private async process_passback(req: any, res: any): Promise<void> {
        if (!req.body) return res.status(400).send('Bad Request');
        if (! this.verify_passback(req)) return res.status(401).send('unauthorized')
        let { token, message, hash, timestamp } = req.body //restructure to mirror botkit message structure
        // if (! await this.verify_passback(req)) {
        //     return res.status(401).send('Unauthorized')
        // }
        if (! message) return res.status(400).send('Bad Request: no message body');
        res.status(201).send(hash) //initial confirmation to turn off bot thread and let it wait/move wait to redis
        let status = await this.process_client_update(message)  //verify that the client response was sent and recieved correctly
        let response_status = status ? status : 'no_response'
        axios.post(`${this.__listener_url}/portal/status`,{'hash':hash, 'status':response_status}) //sending final confirm to portal
        .then((response) => {//TODO need to add something here 
        //   console.log(response);
        })
        .catch((err) => {
        //   console.log(err);
        });

    }

    // private method for passing updated passback to client - passing as a 
    private async process_client_update(message: any) : Promise<any> {
        let { channel, team, timestamp, body, type } = message
        const token = await this.get_bot_token(team)
        const bot = <SlackBotWorker> await this.__controller.spawn(team) //should work fine for both versions of botkit
        const original_msg = await bot.api.conversations.history({ //this is erroring because its returning a generic botworker, not a slack botworker...
            token, 
            channel,
            latest: timestamp,
            inclusive: true,
            limit: 1
        })
        return {status: 'failed', 'error' : null}
    }
    
    //=============== UTILITIES ===========================

    // gets the bot token for a given team for passbacks
    private async get_bot_token(team: string) : Promise<string> {
        const slackAdapter = this.__controller.adapter;
        if (slackAdapter.botToken && slackAdapter.botToken.length > 0) {
            return new Promise((resolve, reject) => {
                resolve(slackAdapter.botToken);
            })
        }
        else {
            return slackAdapter.getTokenForTeam(team);
        }
    }

    private verify_passback(req: any): boolean {
        const originURL = req.protocol + '://' + req.get('host')
        if (!originURL != this.__config.listener_url) return false
        return (req.headers.token && req.headers.token == this.__config.client_secret)
    }

    private process_controller(controller: Botkit): void {
        this.__controller = controller
        this.__is_legacy = typeof controller.version == 'function'
        // compare support usage to general usage
        this.__usage = {
            workspaces: {}, //need # workspaces for billing/compare w/active users
            slash: {t: 0, p: 0}, 
            m_action: {t: 0, p: 0},
            b_action: {t: 0, p: 0},
            dm: {t: 0, p: 0},
            im: {t: 0, p: 0},
            modal: {t: 0, tx: 0, tc:0, p: 0, px:0, pc:0} //track modal closures and cancels
        }
    }
    //TODO this should be straightforward
    private hashWorkspaceId(workspace_id: string ): string {
        return workspace_id
    }
    // log anonymized usage
    private log_usage(message: any): void {
        let id = this.hashWorkspaceId(message.workspace_id)
        this.__usage.workspaces[id] = moment().unix()
        let type = null
        switch (message.type) {
            case 'slash_command':
                type = 'slash'
                break;
            case `message_action`:
                type = 'm_action'
                break;
            case `block_actions`:
                type = 'b_action'
                break;
            case 'mention':
            case 'direct_mention':
                type = 'dm'
                break;
            case 'view_submission':
            case 'view_closed':
                type = 'modal'
                break;
            default:
                break;
        }
        this.__usage[type].t += 1
        if (message.type == 'view_closed') {
            if (message.is_cleared) this.__usage[type].tc +=1
            else this.__usage[type].tx +=1
        }
        if (message.is_portal) {
            this.__usage[type].p += 1
            if (message.type == 'view_closed') {
                if (message.is_cleared) this.__usage[type].pc +=1
                else this.__usage[type].px +=1
            }
        }
    }

    private get_usage(): string {
        try {
            return btoa.encode(JSON.stringify(this.__usage))
        } catch (err) {
            return 'usage_stats_failed'
        }
        
    }

}

