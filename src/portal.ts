/**
 * @module botkit-portal-slack
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */


// this is what we're publicly exposing as the plugin
import { Botkit, BotWorker } from "Botkit"
import axios, { AxiosRequestConfig, AxiosPromise } from 'axios';
import { SlackBotWorker, SlackAdapter, SlackDialog } from "botbuilder-adapter-slack";
import _ = require('lodash')
import moment = require('moment');
import { createCipheriv, randomBytes } from 'crypto'
import random = require('randomstring');

export class BotkitPortalPlugin {

    private __config: any
    private __controller: Botkit
    private __botversion: string
    private __is_legacy: boolean
    private __receiver_url: string
    private __listener_url: string
    private __usage: any
    private __passthrough: boolean

    public name: string = 'Slack Portal Plugin'
    private LISTENER_URL: string = 'https://app.portalforslack.com/portal/intake' //have a hard-coded version
    private PORTAL_CALLBACK_ID: string = 'action_portal_launch'

    /**
     * config should include:
     *   - botkit controller, 
     *   - reciever_url; the url your bot is hosted at,
     *   - portal_token: the auth token you'll recieve from Portal
     *   - clientSigningSecret: signing secret for verifying messages from portal - same process as with slack
     *   - listeners: terms for each 
     *      - at_mention []: if you have a term or terms that should activate a modal from an at_mention (like <at>bot help, <at>bot support)
     *      - slash_command []: any specific slash command or command-term sequence that portal should listen for (/help, /bot help, /bot feedback, etc)
     *          - defaults to /[bot] support [text] and /[bot] feedback
     *      - im []: listens for an IM callback with the specific terms listed, launches support modal
     *   - actions:
     *      - dialog: intercepts dialog content and passes to portal backend for processing
     * 
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
                slash: {
                    feedback: null,
                    support: null,
                    help: null,
                    helpdesk: null
                },

                at_mention: keywords,
                actions: [this.PORTAL_CALLBACK_ID]
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
        if (! config.actions) {
            config.actions = [{this.PORTAL_CALLBACK_ID]
        }
        this.__usage = {
            workspaces: [], //need # workspaces for billing/compare w/active users
            slash: {t: 0, p: 0}, 
            at: {t: 0, p: 0},
            im: {t: 0, p: 0, c:0},
            dialog: {t: 0, p: 0, c:0}
        }
        this.__config = config;
    }

    // private get_usage(): any {
    //     let key = random.generate()
    //     let out = []
    //     //randomly encrypt/anonymize workspace ids
    //     for ( let k of this.__usage.workspaces) { 
    //         let cipher = createCipheriv('aes-256-cbc', Buffer.from(key), key);
    //         let encrypted = cipher.update(k);
    //         encrypted = Buffer.concat([encrypted, cipher.final()])
    //         let data = encrypted.toString('hex')
    //         out.push(data)
    //     }
    //     let data_block = Object.assign({}, this.__usage)
    //     data_block.workspaces = out
    //     return data_block
    // }

    private process_controller(controller: Botkit): void {
        this.__controller = controller
        this.__is_legacy = typeof controller.version == 'function'
    }

    // NOTE - for Bolt apps, can use init, then app.use(middleware)
    // BUT, cannot get router (private), so I can't add a listener endpoint
    // DARN...
    /**
     * 
     * @param botkit : requires an initialized botkit instance
     */
    public init(botkit: Botkit): void {
        this.process_controller(botkit)
        // console.log(`Botkit version: ${this.__botversion}`)
        console.log('is_legacy? : ', this.__is_legacy)
        if (!this.__is_legacy) {
            this.__controller.addDep('portal')
        }
        const router = botkit.webserver //THIS MIGHT NOT WORK FOR LEGACY
        // TODO verify that bot has necessary scopes (?) not sure this is necessary as we probably should just be using DMs?
        //  -- this depends on how the origin app interacts with users - if it's DM-heavy, we'll need an alternative
        // TODO need to figure out how to  initialize a handshake with the Portal servers/ handle billing info
        // ============ adds route for handling customer => client comms (passbacks) =========
        router.post(`/portal/update`, this.process_passback)
        //TODO figure out usage stats - need to understand overall usage v/ portal usage, # of teams
        if (!this.__is_legacy) {
            botkit.addPluginExtension('portal', this) //TODO I might just do this manually to keep people from exposing middlewares
            this.__controller.completeDep('portal')
        } else {
            botkit.middleware.receive.use(this.process_incoming_message)
        }
        // TODO send auth call to portal (?)
        // the reasonable way would be to listen to incoming messages, log the associated workspace/enterprise, and append to a tracker in controller
        // then I could send an updated list to portal when new ones pop up
        // also let me see what proportion of messages involve support
        console.log('portal_install_complete')
    }

    public middlewares(botkit: Botkit): object {
        return {
            recieve: [this.process_incoming_message]
        }
    }

    // private process_workspace_data(bot, message): void {
    //     let workspace_id
    //     try{
    //         workspace_id = bot.config.id
    //     } catch (err) {
    //         workspace_id = bot.getConfig('id') //hope this works!
    //     }
    //     if (!this.__usage.workspaces.includes(workspace_id)) {
    //         this.__usage.workspaces.push(workspace_id)
    //     }
    // }
    private async respond_at(bot: SlackBotWorker, message:any): Promise<void>  {
        let keywords = this.__config.listeners.at_mention
        if (!keywords || keywords.length() <=0) // continue to process
        if (!message.text || message.text.length() <= 0) // continue to process, only modal option
        if (message.type == 'direct_mention') {
            if (message.text)message.text.split(' ')[0]
        }
        let action_word = 
        if (message.type == 'mention') {

        }

    }

    private send_to_portal(data, type) {

    }
    /**
     * 
     * @param bot 
     * @param message 
     * @param next 
     */
    private async process_incoming_message(bot: SlackBotWorker, message: any, next: Function): Promise<void> {
        //@ts-ignore working with 2 versions of botkit
        let token = bot.getConfig ? bot.getConfig('token') : bot.config.token ? bot.config.token : bot.config.bot.token
        let type = message.type
        let listners = this.__config.listeners
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
                }
            case 'direct_mention':
            case 'mention': 
                if (!listners.at_mention) break;
                await this.respond_at(bot, message)
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
        axios.post(`${this.__listener_url}/api/portal/status`,{'hash':hash, 'status':response_status}) //sending final confirm to portal
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

    //needs to work with 4.0 and original botkit - very different systems...
    private async spawn(token: string, team:string, message:any): Promise<BotWorker> {
        return <SlackBotWorker> {}
    }

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

    private async verify_passback(req): Promise<boolean> {
        //also be able to verify IP/origin URL?
        const originURL = req.protocol + '://' + req.get('host')
        const originIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        //TODO check timestamp - these messages shouldn't be more than 10 seconds off or so...
        return new Promise((resolve, reject) => {
            try {
                if (req.body.token && req.body.token == this.__config.token) return resolve(true)
                return resolve(false)
            } catch (err) {
                return resolve(false) //fail silently
            }
        })
    }
}

