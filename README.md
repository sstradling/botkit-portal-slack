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

## Install Portal slack app in your Slack workspace

<a href="https://portalforslack.com/slack/install_npm" target="_blank">
<img src="https://cdn.brandfolder.io/5H442O3W/as/pl54cs-bd9mhs-czsxst/btn-add-to-slack.svg", width=200></img>
</a>

When you install Portal into your Slack workspace, you will receive two tokens: a portal token (starts with `portalt_`) and a client secret (`portalc_`). These are required for your app to interact with the Portal service 

## Use Portal in your App

Configure the plugin with the URI of your app instance, and the portal token and client signing secret you'll receive when you install the Portal app.

The plugin defaults to listening for the following commands:

- **/<your_app_slash_command> [feedback | support | ...other keywords] ...any additional text :** Launches our feedback modal, prepopulated with any additional text included in the command. 
 
- **/[feedback | support | ... other keywords] ...any additional text:** This requires configuring corresponding slash commands for your app at https://api.slack.com/apps/[your_app_id]/slash-commands. 
 
- **@your_app_name [support | help | feedback| ... other keywords ] ...any additional text:** This has the same functionality as slash commands.  We don't (yet) support free-text @mentions - like 'hey @awesome_app, can I get some help?'.

- **Slack Actions:** If you want to trigger the support dialog/modal from an IM or BlockKit action, use `action_portal_launch[:type]` as your action_id. If you want to be able to specify a type (e.g.: feedback v. support requsets), you can append a type to the end of your IM or Block button value. 
  - You can also use this pattern for a callback_id for message actions (configure at https://api.slack.com/apps/[your_app_id]/interactive-messages) if you'd like to use them.

You can configure specific slash ('/') and at ('@') commands for your bot using the following format: 
```
{
    listeners: {
        keywords: [list of keywords] // use this if you have common keywords you want to listen for afer all app /commands
        slash_command: [
            {
                <slash command>: [list of secondary keywords (e.g.: support, help, feedback)]
                <another command>: [] //an empty list tells portal to respond to the /command directly. This allows it to pull all text from the command as content - e.g.: /support I have a major complaint
            }
        ],
        at_mention: [list of secondary keywords], //If no secondary keywords are specified, then we respond to all @mention DMs
    }
}
```


One last option is to enable/disable passthrough - keeping passthrough enabled will have Portal pass all messages on to your bot once it's done, while disabling it will have Portal stop processing messages directed to Portal once they are processed. Passthrough is enabled by default, but we recommend disabling it if you have no plans to log/register/conduct additional processing.


```
 {
     ...
     passthrough: true,
     ...
 }
 ```

Finally, initialize the plugin and install into your app's Botkit controller: 
Initialize the plugin: 

```javascript
// or for legacy botkit apps (0.7/* and below)
let Portal = require('botkit-portal-slack')

let portal = Portal.slack({
    receiver_url: 'https://your_app_URI/', 
    portal_token: 'token_from_portal_setup', // DO NOT commit the actual token into your source code
    client_secret: 'other_token_from_portal', // DO NOT commit this token either.
    listeners: {} // see the discussion of listeners above
});
```

NOTE - the receiver URL should be the same base URL that you registered with Slack to receive Event API calls. Do not include `/slack/receive` or any other secondary routes, as Portal generates its own routes for handling cross-platform messages.


To install the plugin on bots using Botkit (v. 0.7.* and below):

```
controller = new Botkit.slackbot(config)

portal.init(controller)
```

Once registered, Botkit will automatically integrate Portal into your bot, where it will listen for support/helpdesk/feedback requests and pass support conversations back and forth between your app and your Slack workspace. 


## Requirements

Botkit (v 0.7.5 and below)

Node (>8.0.0)
