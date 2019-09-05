/* global browserMaxWidth, browserMaxHeight, screenshotDir,
   chromeBinaryPath, firefoxBinaryPath
*/

/*
 * Automates testing of a testable project. In a nutshell, it does everything
 * you would do if you had to test a testable FCC project manually.
 *
 * It uses Selenium to:
 * - Click on the "Run Tests" button.
 * - Wait for the "Tests" button to show failure or success.
 * - Click on the "Tests" button to see the results.
 * - Grab a screenshot of the results and save it to disk.
 *
 */

// Used to save screenshots.
const fs = require('fs');
const path = require('path');

// Chromedriver and geckodriver are used by Selenium and requiring the module
// avoids having to download and install the executable from Google
// along with setting the path.
require('chromedriver');
require('geckodriver');

const { Builder, By, until } = require('selenium-webdriver');

const chrome = require('selenium-webdriver/chrome');
const firefox = require('selenium-webdriver/firefox');

let screenShotUniq = 0;

// If elements don't appear within 1 minute, it's usually an error.
const elementTimeout = 60000;

// headless mode for chrome and firefox is enabled by default
let headless = process.env.HEADLESS !== '0';

/**
 * @param {string} browser - name of browser
 * @param {string} name - test name
 * @param {string} URL - URL to test
 *
 * @returns {Promise<{success: boolean, err: string}>} - test result
 */
exports.doesProjectPassTests = async function(browser, name, URL) {
  // The following functions are defined below instead of outside this function
  // so we do not have to pass the 'driver' as a function parameter. It makes
  // the functions easier to use in a 'then' chain.

  // Grab a screenshot and write to disk.
  const saveScreenshot = async(name, type) => {
    const fileName =
      `test-result-${screenShotUniq}-${browser}-` +
      `${name.replace(/[ :]/g, '_')}-${type}.png`;

    screenShotUniq++;

    const data = await driver.takeScreenshot();
    if (data) {
      var base64Data = data.replace(/^data:image\/png;base64,/, '');
      fs.writeFile(
        path.join(screenshotDir, fileName),
        base64Data,
        'base64',
        err => {
          if (err) {
            console.warn(err);
          }
        }
      );
    }
  };

  // Locates an element and then clicks it.
  const clickElement = async locator => {
    const element = await driver.wait(
      until.elementLocated(locator),
      elementTimeout
    );
    await driver.wait(until.elementIsVisible(element), elementTimeout);
    await element.click();
    return element;
  };

  // Waits for an element to have opacity of 1. Helps for waiting for elements
  // that fade in. Returns the element when the opacity reaches '1' so that
  // this can be chained with other promises.
  const waitOpacity = element =>
    driver.wait(() =>
      element
        .getCssValue('opacity')
        .then(opacity => (opacity === '1' ? element : false))
    );

  const collectErrors = async wrapper => {
    const elements = await driver.wait(
      By.js(
        wrapper =>
          (wrapper.shadowRoot ? wrapper.shadowRoot : wrapper).querySelectorAll(
            '.test.fail'
          ),
        wrapper
      )
    );
    const errors = [];
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const heading = await element.findElement(By.css('h2'));
      const error = await element.findElement(By.className('error'));
      errors.push(`${await heading.getText()}\n${await error.getText()}`);
    }
    err = errors.join('\n\n');
  };

  const chromeOptions = new chrome.Options()
    .addArguments(
      // Decrease log output, on Windows it's verbose.
      'log-level=3',
      // Some of the tests make noise, so turn off the sound.
      'mute-audio'
    )
    .setChromeBinaryPath(chromeBinaryPath);

  let firefoxOptions = new firefox.Options()
    .setPreference('media.volume_scale', '0.0')
    .setBinary(firefoxBinaryPath);

  if (headless) {
    chromeOptions.headless();
    firefoxOptions.headless();
  }

  // Create the browser.
  const driver = await new Builder()
    .forBrowser(browser)
    .setChromeOptions(chromeOptions)
    .setFirefoxOptions(firefoxOptions)
    .build();

  // If all of the project tests pass, this is set to true.
  let success = false;
  let err;

  // Test automation starts here.
  try {
    // Firefox doesn't have an option to maximize the window
    // So we set the size here.
    await driver
      .manage()
      .window()
      .setRect({
        x: 0,
        y: 0,
        width: browserMaxWidth,
        height: browserMaxHeight
      });

    // Get the specified URL.
    await driver.get(`${URL}`);

    // Wait for the page to finish loading. In some cases, just for example the
    // D3 projects, projects are loading remote data, so we have to be generous
    // here.
    // TODO: A better way to do this is to change all of the example projects to
    // set a variable such as 'fccTestableProjectsDataLoaded', and then we can
    // wait for that variable to be true. But that will require changing every
    // example project.
    await driver.sleep(2000);

    const wrapper = await driver.wait(
      until.elementLocated(By.id('fcc_test_suite_wrapper')),
      elementTimeout
    );

    // Run the tests by clicking our test button after the element appears.
    // In order to click anything inside the Shadow DOM, we need to locate by
    // webdriver.By.js, which uses webdriver.executeScript internally. It
    // accepts a stringified Function as the first argument and an additional
    // argument -- in this case the element, #fcc_test_suite_wrapper
    // More info in https://stackoverflow.com/a/21125803/3530394 and
    // https://www.codesd.com/item/access-to-the-elements-in-the-shadow-dom.html
    // and in the jsdocs for `selenium-webdriver/by.js`

    await clickElement(
      By.js(
        wrapper =>
          (wrapper.shadowRoot ? wrapper.shadowRoot : wrapper).querySelector(
            '#fcc_test_message-box-rerun-button'
          ),
        wrapper
      )
    );

    // Wait for 'fcc_test_btn-done' class to be added to the 'Tests' button
    // then click
    const resultElement = await clickElement(
      By.js(
        wrapper =>
          (wrapper.shadowRoot ? wrapper.shadowRoot : wrapper).querySelector(
            '.fcc_test_btn-done'
          ),
        wrapper
      )
    );

    success = (await resultElement.getAttribute('class')).includes(
      'fcc_test_btn-success',
      0
    );

    // Wait for the test results modal. The message box fades in, so we wait for
    // opacity of 1 before grabbing the screenshot.
    await driver
      .wait(
        until.elementLocated(
          By.js(
            wrapper =>
              (wrapper.shadowRoot ? wrapper.shadowRoot : wrapper).querySelector(
                '.fcc_test_message-box-shown'
              ),
            wrapper
          )
        ),
        elementTimeout
      )
      .then(waitOpacity);

    if (!success) {
      await collectErrors(wrapper);
    }

    await saveScreenshot(name, 'FINAL');
  } catch (error) {
    if (!err) {
      err = '' + error;
    }
    try {
      await saveScreenshot(name, `ERROR-${error.name}`);
    } catch {
      // suppress error
    }
  }

  // We are done. Close the browser and return with success status.
  try {
    await driver.quit();
  } catch {
    // suppress error
  }

  return { success, err };
};
