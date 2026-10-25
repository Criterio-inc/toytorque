// ToyTorque som Mac-app: ett tunt skal runt webbspelet i dist/.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  toytorque_lib::run();
}
