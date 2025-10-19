# onchain-token-data-dashboard
A real-time analytics dashboard that streams token data directly from gmgn.ai. With this tool, you can monitor any token listed on gmgn.ai and visualize how on-chain metrics evolve in real time. Ideal for tracking market behavior, detecting accumulation or distribution patterns, and understanding how whales influence price action.

# Key features:
📊 Live streaming of token metrics (via gmgn.ai)

👥 Real-time tracking of holders, top 100 avg cost, top 100 holding, top 10 holding, price, and more

🔄 Ability to overlay multiple graphs for correlation analysis between metrics

⚡ Fast, dynamic, and built for on-chain researchers and quantitative traders

# Repository contents

The repository conatains 3 main files:
- ws_server.js - a server that listens for data from gmgn.ai logger
- logger_browser_console.js - the very logger that streams data from the website to the server. You don't have to run it as a server file, you just have to paste it in DevTools console in your browser.
- graph.html - html dashboard that requests data from the local server and interpret it into a graphical form.

  # Setting up

  1. Open cmd(for Windows) in the repository's folder. Set the server up by pasting this into console:
     MacOS/Linux:
     npm init -y
     npm install ws
     AUTH_TOKEN=my-secret-token node ws-server.js

     Windows:
     npm init -y
     npm install ws
     set AUTH_TOKEN=my-secret-token&& node ws-server.js

     This will set the server and the authentication key for it, here "my-secret-token"
     
  2. Run the dashboard. Head to your browser and paste "http://127.0.0.1:8080/graph.html" into the URL bar. If the server was set correctly, the dashboard will open. Press connect on the top of the page. You will see client connected in server's console.
  3. Find a token on gmgn.ai you want to stream. Pick any token, open the graph and press F12 on your keyboard or open the website's cond manually. Select "Console" on the top, paste logger_browser_console.js script into it and press enter.
  Now everything is done. You'r ready to see extended info in the dashboard. Just select the token there and you will see the charts appearing.




