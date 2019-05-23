import React, { Component } from "react";
import { Mutation, Query, Subscription } from "react-apollo";
import * as THREE from "three";
import Stats from "stats-js";

import { Camera, Light, Player, Renderer, World } from "../Bin";
import classes from "./MainScene.module.css";
import { Hint } from "../../../../Utils";
import Config from "../../Data/Config";
import Helpers from "../../Utils/Helpers";
import {
  WORLD_QUERY,
  BLOCK_SUBSCRIPTION,
  UPDATE_PLAYER_MUTATION
} from "../../../../../lib/graphql";
import ResourceManager from "../../Data/ResourceManager/ResourceManager";
import RectAreaLightUniformsLib from "../Bin/Light/RectAreaLightUniformsLib";

class MainScene extends Component {
  constructor(props) {
    super(props);
    // Initializing RectAreaLight Library
    RectAreaLightUniformsLib(THREE);

    this.initPos = null;
    this.initDirs = null;

    this.prevPos = {};
    this.prevDirs = {};

    this.updatePlayer = null;

    // Load textures
    this.resourceManager = new ResourceManager();
    this.resourceManager.initialize();
  }

  handleQueryComplete = () => {
    // Prerequisites
    window.requestAnimationFrame =
      window.requestAnimationFrame ||
      window.mozRequestAnimationFrame ||
      window.webkitRequestAnimationFrame ||
      window.msRequestAnimationFrame ||
      function(f) {
        return setTimeout(f, 1000 / 60);
      }; // simulate calling code 60

    window.cancelAnimationFrame =
      window.cancelAnimationFrame ||
      window.mozCancelAnimationFrame ||
      function(requestID) {
        clearTimeout(requestID);
      }; //fall back

    // Player setup
    this.currentPlayer = this.worldData.players.find(
      ele => ele.user.username === this.props.username
    );
    this.initPos = {
      x: this.currentPlayer.x,
      y: this.currentPlayer.y,
      z: this.currentPlayer.z
    };
    this.initDirs = {
      dirx: this.currentPlayer.dirx,
      diry: this.currentPlayer.diry
    };

    // Main scene creation
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(Config.fog.color);
    this.scene.fog = new THREE.Fog(
      Config.fog.color,
      Config.fog.near,
      Config.fog.far
    );

    // Main renderer constructor
    this.renderer = new Renderer(this.scene, this.mount);

    // Components instantiations
    this.camera = new Camera(this.renderer.threeRenderer);
    this.light = new Light(this.scene);
    this.light.place("ambient");

    // Stats creation
    this.stats = new Stats();
    this.mount.appendChild(this.stats.dom);

    // World Initialization
    this.world = new World(
      this.props.id,
      this.scene,
      this.worldData,
      this.client,
      this.resourceManager
    );

    // Player initialization
    this.player = new Player(
      this.currentPlayer.id,
      this.camera.threeCamera,
      this.scene,
      this.world,
      this.mount,
      this.blocker,
      this.initPos,
      this.initDirs,
      this.resourceManager,
      this.currentPlayer.inventory,
      this.updatePlayer
    );

    this.world.setPlayer(this.player);

    this.init();

    /** Called every 200ms to update player position with server. */
    this.updatePosCall = setInterval(() => {
      const playerCoords = this.player.getCoordinates(),
        playerDirs = this.player.getDirections();

      // Making sure no values are null
      for (let member in playerCoords)
        if (playerCoords[member] !== 0 && !playerCoords[member]) return;
      for (let member in playerDirs)
        if (playerDirs[member] !== 0 && !playerDirs[member]) return;

      if (
        !(JSON.stringify(playerCoords) === JSON.stringify(this.prevPos)) ||
        !(JSON.stringify(playerDirs) === JSON.stringify(this.prevDirs))
      ) {
        this.prevPos = { ...playerCoords };
        this.prevDirs = { ...playerDirs };
        this.updatePlayer({
          variables: {
            id: this.currentPlayer.id,
            ...playerCoords,
            ...playerDirs
          }
        });
      }
    }, 200);

    this.updateWorldCall = setInterval(() => this.updateWorld(), 500);
  };

  componentWillUnmount() {
    this.terminate();
    this.mount.removeChild(this.renderer.threeRenderer.domElement);
  }

  init = () => {
    window.addEventListener("resize", this.onWindowResize, false);
    if (!this.frameId)
      this.frameId = window.requestAnimationFrame(this.animate);
  };

  terminate = () => {
    window.cancelAnimationFrame(this.frameId);
    clearInterval(this.updatePosCall);
    clearInterval(this.updateWorldCall);
  };

  animate = () => {
    this.stats.begin();
    this.update();
    this.renderScene();
    this.stats.end();
    if (!document.webkitHidden)
      this.frameId = window.requestAnimationFrame(this.animate);
  };

  update = () => {
    this.player.update();
    // console.log(this.player.getCoordinates());
  };

  renderScene = () => {
    this.renderer.render(this.scene, this.camera.threeCamera);
  };

  updateWorld = () => {
    const { coordx, coordy, coordz } = Helpers.toChunkCoords(
      this.player.getCoordinates()
    );

    this.world.requestMeshUpdate({
      coordx,
      coordy,
      coordz
    });
  };

  onWindowResize = () => {
    this.camera.updateSize(this.renderer.threeRenderer);
    this.renderer.updateSize();
  };

  render() {
    const { id: worldId } = this.props;

    return (
      <Query
        query={WORLD_QUERY}
        variables={{ query: worldId }}
        onError={err => console.error(err)}
        fetchPolicy="network-only"
        onCompleted={({ world }) => {
          this.worldData = world;
          if (this.mount) this.handleQueryComplete();
          else this.waitingForMount = true;
        }}
      >
        {({ loading, data }) => {
          if (loading) return <Hint text="Loading world..." />;
          if (!data) return <Hint text="World not found." />;

          return (
            <Mutation
              mutation={UPDATE_PLAYER_MUTATION}
              onError={err => console.error(err)}
            >
              {(updatePlayer, { client }) => {
                this.updatePlayer = updatePlayer; // Hooked updatePlayer for outter usage
                this.client = client;

                return (
                  <div
                    style={{
                      width: "100%",
                      height: "100%"
                    }}
                    ref={mount => {
                      this.mount = mount;
                      if (this.waitingForMount) {
                        this.waitingForMount = false;
                        this.handleQueryComplete();
                      }
                    }}
                  >
                    <div
                      className={classes.blocker}
                      ref={blocker => (this.blocker = blocker)}
                    />
                    <img
                      src={this.resourceManager.getGuiImg("crosshair")}
                      alt=""
                      className={classes.crosshair}
                    />
                    <Subscription
                      subscription={BLOCK_SUBSCRIPTION}
                      variables={{ worldId }}
                      onSubscriptionData={({ subscriptionData: { data } }) =>
                        this.world.updateChanged(data)
                      }
                    />
                  </div>
                );
              }}
            </Mutation>
          );
        }}
      </Query>
    );
  }
}

export default MainScene;
