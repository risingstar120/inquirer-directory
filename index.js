/**
 * `directory` type prompt
 */

var _ = require("lodash");
var util = require("util");
var chalk = require("chalk");
var figures = require("figures");
var cliCursor = require("cli-cursor");
var Base = require("inquirer/lib/prompts/base");
var observe = require("inquirer/lib/utils/events");
var Paginator = require("inquirer/lib/utils/paginator");
var Choices = require('inquirer/lib/objects/choices');
var Separator = require('inquirer/lib/objects/separator');

var path = require('path');
var fs = require('fs');

/**
 * Module exports
 */

module.exports = Prompt;

/**
 * Constants
 */
var CHOOSE = "choose this directory";
var BACK = "go back a directory";

/**
 * Constructor
 */

function Prompt() {
  Base.apply( this, arguments );

  if (!this.opt.basePath) {
    this.throwParamError("basePath");
  }

  this.depth = 0;
  this.currentPath = path.isAbsolute(this.opt.basePath) ? path.resolve(this.opt.basePath) : path.resolve(process.cwd(), this.opt.basePath);
  this.opt.choices = new Choices(this.createChoices(this.currentPath), this.answers);
  this.selected = 0;

  this.firstRender = true;

  // Make sure no default is set (so it won't be printed)
  this.opt.default = null;

  this.paginator = new Paginator();
}
util.inherits( Prompt, Base );


/**
 * Start the Inquiry session
 * @param  {Function} cb      Callback when prompt is done
 * @return {this}
 */

Prompt.prototype._run = function( cb ) {
  this.done = cb;
  var alphaNumericRegex = /\w/i;
  var events = observe(this.rl);

  var keyUps = events.keypress.filter(function (e) {
    return e.key.name === 'up';
  }).share();

  var keyDowns = events.keypress.filter(function (e) {
    return e.key.name === 'down';
  }).share();
  var alphaNumeric = events.keypress.filter(function (e) {
    return alphaNumericRegex.test(e.value);
  }).share();

  var outcome = this.handleSubmit(events.line);
  outcome.drill.forEach( this.handleDrill.bind(this) );
  outcome.back.forEach( this.handleBack.bind(this) );
  keyUps.takeUntil( outcome.done ).forEach( this.onUpKey.bind(this) );
  keyDowns.takeUntil( outcome.done ).forEach( this.onDownKey.bind(this) );
  alphaNumeric.takeUntil( outcome.done ).forEach( this.onKeyPress.bind(this) );
  outcome.done.forEach( this.onSubmit.bind(this) );

  // Init the prompt
  cliCursor.hide();
  this.render();

  return this;
};


/**
 * Render the prompt to screen
 * @return {Prompt} self
 */

Prompt.prototype.render = function() {
  // Render question
  var message = this.getQuestion();

  if ( this.firstRender ) {
    message += chalk.dim( "(Use arrow keys)" );
  }


  // Render choices or answer depending on the state
  if ( this.status === "answered" ) {
    message += chalk.cyan( path.relative(this.opt.basePath, this.currentPath) );
  } else {
    message += chalk.bold("\n Current directory: ") + this.opt.basePath + "/" + chalk.cyan(path.relative(this.opt.basePath, this.currentPath));
    var choicesStr = listRender(this.opt.choices, this.selected );
    message += "\n" + this.paginator.paginate(choicesStr, this.selected, this.opt.pageSize);
  }

  this.firstRender = false;

  this.screen.render(message);
};


/**
 * When user press `enter` key
 */
Prompt.prototype.handleSubmit = function (e) {
  var self = this;
  var obx = e.map(function () {
    return self.opt.choices.getChoice( self.selected ).value;
  }).share();

  var done = obx.filter(function (choice) {
    return choice === CHOOSE;
  }).take(1);

  var back = obx.filter(function (choice) {
    return choice === BACK;
  }).takeUntil(done);

  var drill = obx.filter(function (choice) {
    return choice !== BACK && choice !== CHOOSE;
  }).takeUntil(done);

  return {
    done: done,
    back: back,
    drill: drill
  };
};

/**
 *  when user selects to drill into a folder (by selecting folder name)
 */
Prompt.prototype.handleDrill = function () {
  var choice = this.opt.choices.getChoice( this.selected );
  this.depth++;
  this.currentPath = path.join(this.currentPath, choice.value);
  this.opt.choices = new Choices(this.createChoices(this.currentPath), this.answers);
  this.selected = 0;
  this.render();
};

/**
 * when user selects ".. back"
 */
Prompt.prototype.handleBack = function () {
  var choice = this.opt.choices.getChoice( this.selected );
  this.depth--;
  this.currentPath = path.dirname(this.currentPath);
  this.opt.choices = new Choices(this.createChoices(this.currentPath), this.answers);
  this.selected = 0;
  this.render();
};

/**
 * when user selects "choose this folder"
 */
Prompt.prototype.onSubmit = function(value) {
  this.status = "answered";

  // Rerender prompt
  this.render();

  this.screen.done();
  cliCursor.show();
  this.done( path.relative(this.opt.basePath, this.currentPath) );
};


/**
 * When user press a key
 */
Prompt.prototype.onUpKey = function() {
  var len = this.opt.choices.realLength;
  this.selected = (this.selected > 0) ? this.selected - 1 : len - 1;
  this.render();
};

Prompt.prototype.onDownKey = function() {
  var len = this.opt.choices.realLength;
  this.selected = (this.selected < len - 1) ? this.selected + 1 : 0;
  this.render();
};

Prompt.prototype.onKeyPress = function(e) {
  var index = findIndex.call(this, e.value);
  if (index >= 0) {
    this.selected = index;
  }
  this.render();
};

function findIndex (letter) {
  var item;
  for (var i=0; i < this.opt.choices.realLength; i++) {
    item = this.opt.choices.realChoices[i].name.toLowerCase();
    if (item[0] === letter) {
      return i;
    }
  }
  return -1;
}

/**
 * Helper to create new choices based on previous selection.
 */
Prompt.prototype.createChoices = function (basePath) {
  var choices = getDirectories(basePath);
  if (choices.length > 0) {
    choices.push(new Separator());
  }
  choices.push(CHOOSE);
  if (this.depth > 0) {
    choices.push(new Separator());
    choices.push(BACK);
    choices.push(new Separator());
  }
  return choices;
};

/**
 * Function for rendering list choices
 * @param  {Number} pointer Position of the pointer
 * @return {String}         Rendered content
 */
 function listRender(choices, pointer) {
  var output = '';
  var separatorOffset = 0;

  choices.forEach(function (choice, i) {
    if (choice.type === 'separator') {
      separatorOffset++;
      output += '  ' + choice + '\n';
      return;
    }

    var isSelected = (i - separatorOffset === pointer);
    var line = (isSelected ? figures.pointer + ' ' : '  ') + choice.name;
    if (isSelected) {
      line = chalk.cyan(line);
    }
    output += line + ' \n';
  });

  return output.replace(/\n$/, '');
}

/**
 * Function for getting list of folders in directory
 * @param  {String} basePath the path the folder to get a list of containing folders
 * @return {Array}           array of folder names inside of basePath
 */
function getDirectories(basePath) {
  return fs
    .readdirSync(basePath)
    .filter(function(file) {
      var isDir = fs.statSync(path.join(basePath, file)).isDirectory();
      var isNotDotFile = path.basename(file).indexOf('.') !== 0;
      return isDir && isNotDotFile;
    })
    .sort();
}
