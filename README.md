# botkit-portal-slack

Integrate simple customer support in your Botkit Slack app 

## Install Package

Add this package to your project using npm:

```bash
npm install --save botkit-portal-slack
```

Import the adapter class into your code:

```javascript
const { Portal } = require('botkit-portal-slack');
```

## Use in your App

Configure the plugin with the URI of your app instance, and the portal token and client signing secret you'll recieve when you install the Portal app.

The plugin defaults to listening for the following commands:
 /<your_app_slash_command> [feedback | support | <other specified type>] <any additional text here> : launches our feedback modal, prepopulated with any additional text included in the command. The modal also includes a dropdown populated with your pre-specified request types.
 /[feedback | support | <other specified type>] <any additional text>: this requires configuring corresponding slash commands for your app at https://api.slack.com/apps/<your_app_id>/slash-commands. 
 @<app name> [support | help | feedback| <other specified type>] <any additional text here>: we don't support free-text @mentions - like 'hey @<app>, can I get some help?' yet. @mentions cannot directly 

if you want to trigger the support dialog/modal from an IM or BlockKit action, Portal listens for ```action_portal_launch[:<type>]``` action values by default. If you want to be able to specify a type (e.g.: 'Send us feedback' v. 'Make a support request'), you can append a type to the end of your IM or Block button value. You can also use this pattern for a callback_id for message actions (configure at https://api.slack.com/apps/<your_app_id>/interactive-messages) if you'd like to use them.

You can configure specific slash ('/') and at ('@') commands for your bot using the following format: 
```{
    listeners: {
        slash_command: [
            {
                <slash command>: [list of secondary keywords (e.g.: support, help, feedback)]
                <another command>: [] //an empty list tells portal to respond to the /command directly. This allows it to pull all text from the command as content - e.g.: /support I have a major complaint
            }
        ],
        at_mention: [list of secondary keywords],
    }
}```

One last option is to enable/disable passthrough - enabling passthrough will have Portal stop processing messages directed to Portal, while keeping it disabled will have Portal pass all messages on to your bot once it's done. Passthrough is enabled by default.
 ```{
     ...
     passthrough: true,
     ...
 }```

Finally, initialize the plugin and install into your app's Botkit controller:  
Initialize the plugin: 
```javascript
// import
import { BotkitPortalPlugin } from 'botkit-portal-slack'
// or for legacy botkit apps (0.7/* and below)
let { BotkitPortalPluginLegacy } = require('botkit-portal-slack)

let portal = new BotkitPortalPlugin({
    receiver_url: 'https://your_app_URI/', 
    portal_token: 'token_from_portal_setup', // DO NOT commit the actual token into your source code
    client_secret: 'other_token_from_portal, // DO NOT commit this token either.
    commands: {see above}
});
```
NOTE - the receiver URL should be the same base URL that you registered with Slack to receive Event API calls. Do not include '/slack/receive' or any other secondary routes, as portal will set up its own TLS 1.2 route for handling cross-platform messages.

To install the plugin on bots using Botkit 4.*:

```
controller = new Botkit.slackbot(config)

controller.usePlugin(portal)

```

To install the plugin on bots using legacy Botkit (v. 0.7.* and below):

```
controller = new Botkit.slackbot(config)

portal.init(controller)
```

Once registered, Botkit will automatically integrate Portal into your bot, where it will listen for support/helpdesk/feedback requests and pass support conversations back and forth between your app and your Slack workspace. 

