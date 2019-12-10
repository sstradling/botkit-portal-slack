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
 /<your_app_slash_command> [feedback | support] <any additional text here>
 /[feedback | support] (requires configuring corresponding slash commands for your app [here](https://url_for_app_config)
 @<app name> [support | help | feedback]

if you want to trigger the support dialog/modal from an IM action, Portal listens for ```im_portal_launch``` by default as well. If the event associated with an IM keyword also contains text, Portal will pass that text into the pop-up text field, so you can pre-populate feedback modals

You can configure specific slash ('/') and at ('@') commands for your bot using the following format: 
```{
    commands: {
        slash: [
            {
                <slash command>: [list of secondary keywords (e.g.: support, help, feedback)]
                <another command>: [] //an empty list tells portal to respond to the /command directly. This allows it to pull all text from the command as content - e.g.: /support I have a major complaint
            }
        ],
        at: [list of secondary keywords],
        im: [list of im keywords that Portal should respond to with a modal]

    }
}```

One last option is to enable/disable passthrough - enabling passthrough will have Portal stop processing messages directed to Portal, while keeping it disabled will have Portal pass all messages on to your bot once it's done. This is disabled by default.

Finally, register the plugin and it's features with the Botkit controller using `usePlugin()`

```javascript
let portal = new Portal({
    uri: 'https://your_app_listener_instance.com/',
    portal_token: 'token_from_portal_setup', // DO NOT commit the actual token into your source code
    client_secret: 'other_token_from_portal, // DO NOT commit this token either.
    commands: {see above}
});

controller.usePlugin(portal);
```


Once registered, Botkit will automatically integrate Portal into your bot, where it will listen for support/helpdesk/feedback requests. All of the plugin's methodswill be available at `controller.plugins.portal`.

## Class Reference

* [BotkitCMSHelper](../docs/reference/cms.md)
