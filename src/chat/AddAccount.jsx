// The account switchers' "Add account": signing in to another homeserver (or nookara.cc). The new account joins the others on
// this device (accountSwitch.js); switching to it is in the same menus.
import { Dialog } from './Dialogs.jsx';
import { HomeserverLogin } from './HomeserverLogin.jsx';

export function AddAccount({ onClose }) {
  return (
    <Dialog title="Add an account" sub="Sign in on its homeserver. Your other accounts stay signed in, and you can switch between them." onClose={onClose}>
      {() => <HomeserverLogin back={{}} />}
    </Dialog>
  );
}
