/**
 * @module botkit-portal-slack
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */


// this is what we're publicly exposing as the plugin
import { Botkit, BotWorker} from "Botkit"
import axios, { AxiosRequestConfig, AxiosPromise } from 'axios';
import { SlackBotWorker, SlackAdapter } from "botbuilder-adapter-slack";



export class BotkitPortalPlugin {

    private __config: any
    private __controller: Botkit
    private __botversion: any
    private __reciever_url: string
    private __listener_url: string

    public name: string = 'Slack Portal Plugin'
    private LISTENER_URL: string = 'add portal reciever url here' 

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
        this.__config = config;
        if (config.controller) {
            this.__controller = this.__config.controller;
            this.__reciever_url = this.__config.reciever_url;
            this.__botversion = this.__controller.version;
            this.__listener_url = this.__config.listener_url ? this.__config.listener_url : this.LISTENER_URL
        }
    }

    /**
     * 
     * @param botkit : requires an initialized botkit instance
     */
    public init(botkit: Botkit): void {
        this.__controller = botkit
        this.__controller.addDep('portal')
        const router = botkit.webserver
        // TODO verify that bot has necessary scopes (?) not sure this is necessary as we probably should just be using DMs?
        //  -- this depends on how the origin app interacts with users - if it's DM-heavy, we'll need an alternative
        // TODO need to figure out how to initialize a handshake with the Portal servers/ handle billing info
        // ============ adds route for handling customer => client comms (passbacks) =========
        router.post(`${this.__reciever_url}/portal/update`, this.process_passback)
        if ( this.__botversion >=4 ) {
            botkit.addPluginExtension('portal', this) //TODO I might just do this manually to keep people from exposing middlewares
        } else {
            botkit.middleware.receive.use(this.process_incoming_message)
        }
        this.__controller.completeDep('portal')
    }

    public middlewares(botkit: Botkit): object {
        return {
            recieve: [this.process_incoming_message]
        }
    }

    /**
     * 
     * @param bot 
     * @param message 
     * @param next 
     */
    private process_incoming_message(bot, message, next): void {



        // only call next if message doesn't need to be intercepted...
        next();
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
        let { token, message, hash, timestamp } = req.body //restructure to mirror botkit message structure
        if (! await this.verify_passback(req)) {
            return res.status(401).send('Unauthorized')
        }
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