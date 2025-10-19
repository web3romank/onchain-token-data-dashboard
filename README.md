# onchain-token-data-dashboard
A real-time analytics dashboard that streams token data directly from gmgn.ai. With this tool, you can monitor any token listed on gmgn.ai and visualize how on-chain metrics evolve in real time. Ideal for tracking market behavior, detecting accumulation or distribution patterns, and understanding how whales influence price action.

## Key features:
📊 Live streaming of token metrics (via gmgn.ai)

👥 Real-time tracking of holders, top 100 avg cost, top 100 holding, top 10 holding, price, and more

🔄 Ability to overlay multiple graphs for correlation analysis between metrics

⚡ Fast, dynamic, and built for on-chain researchers and quantitative traders

<img width="920" height="379" alt="image" src="https://github.com/user-attachments/assets/ed8c428d-39b8-4383-ae7b-09085a44a882" />


## Repository contents

The repository contains 3 main files:
- ws_server.js - a server that listens for data from gmgn.ai logger
- logger_browser_console.js - a browser-side logger script that streams live data from gmgn.ai to the local server. You don't need to run it as a server file - simply paste it into your browser's DevTools console.
- graph.html - html dashboard that requests data from the local server and renders it as interactive charts.

  ## Setup

  1. Open Command Prompt (Windows) in the repository's folder. Set the server up by pasting the following command:
     MacOS/Linux:
     npm init -y
     npm install ws
     AUTH_TOKEN=my-secret-token node ws-server.js

     Windows:
     npm init -y
     npm install ws
     set AUTH_TOKEN=my-secret-token&& node ws-server.js

     This will set the server and the authentication key for it, here "my-secret-token"
     
  2. Run the dashboard. Head to your browser and paste "http://127.0.0.1:8080/graph.html" into the URL bar. If the server was set correctly, the dashboard will open. Press "Connect" (pic. 2) on the top of the page. You will see client connected in server's console.

Pic. 2

  <img width="1918" height="902" alt="image" src="https://github.com/user-attachments/assets/06db98ca-0c68-46b7-bbc5-0568b7b939ea" />


  3. Find a token on gmgn.ai you want to stream. Pick any token, open the graph and press F12 on your keyboard or open the website's code manually. Select "Console" on the top, paste logger_browser_console.js script into it and press enter(pic. 3).
  Now everything is done. You're ready to see extended info in the dashboard. Just select the token(pic 4.) there and you will see the charts appearing.

Pic. 3

<img width="1915" height="901" alt="image" src="https://github.com/user-attachments/assets/f85668a8-87e1-4a9f-a54c-e62feb19f57a" />


Pic. 4

<img width="1919" height="836" alt="image" src="https://github.com/user-attachments/assets/01df6269-8bb6-41f8-842a-a7cc19acbd30" />

## Tech Stack
- Node.js (WebSocket server)
- HTML + JavaScript (Frontend)
- gmgn.ai html data streaming




