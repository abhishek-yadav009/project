const fs = require('fs');
let html = fs.readFileSync('c:/Users/Hyper 3/Desktop/iiii/project/frontend/index.html', 'utf8');

// 1. Add forgot password link after login form submit button
html = html.replace(
  '<button class="button primary" type="submit">Log in</button>\r\n          </form>',
  '<button class="button primary" type="submit">Log in</button>\r\n            <button type="button" class="auth-link" data-auth-tab="forgot">Forgot password?</button>\r\n          </form>'
);

// 2. Add forgot and reset forms after register form
const forgotReset = [
  '<form id="forgot-form" class="form-stack hidden">',
  '  <p style="font-size:12px;color:#788696">Enter your email and we\'ll provide a reset code.</p>',
  '  <label>Email <input name="email" type="email" autocomplete="email" required></label>',
  '  <button class="button primary" type="submit">Send reset code</button>',
  '</form>',
  '<form id="reset-form" class="form-stack hidden">',
  '  <p style="font-size:12px;color:#788696">Enter your email, the reset code, and your new password.</p>',
  '  <label>Email <input name="email" type="email" autocomplete="email" required></label>',
  '  <label>Reset code <input name="token" required maxlength="10"></label>',
  '  <label>New password <input name="password" type="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters, a letter and a number.</small></label>',
  '  <button class="button primary" type="submit">Reset password</button>',
  '  <button type="button" class="auth-link" data-auth-tab="login">\u2190 Back to login</button>',
  '</form>',
].map(line => '          ' + line).join('\r\n');

// Find the closing of register-form and insert before auth-message
html = html.replace(
  '<p id="auth-message" class="message" role="status"></p>',
  forgotReset + '\r\n          <p id="auth-message" class="message" role="status"></p>'
);

fs.writeFileSync('c:/Users/Hyper 3/Desktop/iiii/project/frontend/index.html', html, 'utf8');
console.log('HTML patched. Checking for forgot-form:', html.includes('forgot-form'));
console.log('Checking for reset-form:', html.includes('reset-form'));
console.log('Checking for auth-link:', html.includes('auth-link'));
