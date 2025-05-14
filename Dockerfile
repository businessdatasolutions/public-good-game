# 1. Base Image: Use an official Node.js runtime (Alpine is smaller)
FROM node:18-alpine

# 2. Set Working Directory: Create and set the directory inside the container
WORKDIR /usr/src/app

# 3. Copy package files: Copy only package files first to leverage Docker cache
COPY package*.json ./

# 4. Install Dependencies: Install production dependencies
# Use 'npm ci' for faster, more reliable installs if you have package-lock.json
# RUN npm ci --only=production
RUN npm install --only=production

# 5. Copy Application Code: Copy the rest of your application code
# This includes server.js and the public directory
COPY . .

# 6. Expose Port: Inform Docker that the container listens on port 3000
EXPOSE 3000

# 7. Run Command: Define the command to run your application
CMD [ "node", "server.js" ]