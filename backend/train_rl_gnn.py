import numpy as np
import tensorflow as tf
import random
import os


# --- 1. DYNAMIC SPATIO-TEMPORAL ARCHITECTURE ---
class GraphConv(tf.keras.layers.Layer):
    def __init__(self, in_feat, out_feat, aggregation_type="mean", **kwargs):
        super().__init__(**kwargs)
        self.in_feat = in_feat
        self.out_feat = out_feat
        self.aggregation_type = aggregation_type
        self.weight = tf.Variable(
            initial_value=tf.keras.initializers.glorot_uniform()(shape=(in_feat, out_feat), dtype="float32"),
            trainable=True,
        )

    def call(self, inputs):
        features, edges = inputs
        # features is now transposed so num_nodes is axis 0: (num_nodes, batch, seq_len, in_feat)
        num_nodes = tf.shape(features)[0]

        # Node representation
        nodes_representation = tf.matmul(features, self.weight)

        # Message passing (gathering along axis 0)
        neighbour_representations = tf.gather(features, edges[1], axis=0)

        # Now segment_mean perfectly aligns with axis 0
        if self.aggregation_type == "mean":
            aggregated_messages = tf.math.unsorted_segment_mean(
                neighbour_representations, edges[0], num_segments=num_nodes
            )
        else:
            aggregated_messages = tf.math.unsorted_segment_sum(
                neighbour_representations, edges[0], num_segments=num_nodes
            )

        aggregated_messages = tf.matmul(aggregated_messages, self.weight)

        # Combine
        return tf.nn.relu(tf.concat([nodes_representation, aggregated_messages], axis=-1))


class LSTMGC(tf.keras.Model):
    def __init__(self, in_feat, out_feat, lstm_units, output_seq_len, **kwargs):
        super().__init__(**kwargs)
        self.graph_conv = GraphConv(in_feat, out_feat)
        self.lstm = tf.keras.layers.LSTM(lstm_units, activation="relu")
        self.dense = tf.keras.layers.Dense(output_seq_len)
        self.output_seq_len = output_seq_len

    def call(self, inputs):
        features, edges = inputs

        # features shape: (batch, seq_len, num_nodes, in_feat)
        # CRITICAL FIX: Transpose to (num_nodes, batch, seq_len, in_feat) for the GCN
        features_t = tf.transpose(features, [2, 0, 1, 3])

        gcn_out = self.graph_conv([features_t, edges])

        # gcn_out is (num_nodes, batch, seq_len, out_feat * 2)
        shape = tf.shape(gcn_out)
        num_nodes, batch_size, seq_len, feat_dim = shape[0], shape[1], shape[2], shape[3]

        # Transpose back to (batch, num_nodes, seq_len, feat_dim) to keep sequences intact
        gcn_out_batch_first = tf.transpose(gcn_out, [1, 0, 2, 3])

        # Flatten for LSTM: (batch * num_nodes, seq_len, feat_dim)
        lstm_input = tf.reshape(gcn_out_batch_first, (batch_size * num_nodes, seq_len, feat_dim))
        lstm_out = self.lstm(lstm_input)

        dense_out = self.dense(lstm_out)

        # Reshape back to (batch, num_nodes, output_seq_len)
        output = tf.reshape(dense_out, (batch_size, num_nodes, self.output_seq_len))

        # Final shape: (batch, output_seq_len, num_nodes)
        return tf.transpose(output, [0, 2, 1])


# --- 2. REINFORCEMENT LEARNING AGENT ---
class RLAgent:
    def __init__(self, param_space):
        self.action_space = []
        for lr in param_space['learning_rate']:
            for units in param_space['lstm_units']:
                for batch in param_space['batch_size']:
                    self.action_space.append({'lr': lr, 'lstm_units': units, 'batch_size': batch})

        self.q_table = np.zeros(len(self.action_space))
        self.epsilon = 1.0
        self.epsilon_decay = 0.8
        self.alpha = 0.1

    def select_action(self):
        if random.uniform(0, 1) < self.epsilon:
            return random.randint(0, len(self.action_space) - 1)
        return np.argmax(self.q_table)

    def update_q_table(self, action_idx, reward):
        current_q = self.q_table[action_idx]
        self.q_table[action_idx] = current_q + self.alpha * (reward - current_q)
        self.epsilon = max(0.1, self.epsilon * self.epsilon_decay)


# --- 3. CONFLICT RESOLUTION ---
def get_green_lights(predictions, edges):
    """
    Evaluates predictions and topology to determine valid green lights.
    Returns: (active_nodes (list), conflicts (int))
    """
    sources = edges[0]
    targets = edges[1]

    # Group incoming roads by their destination
    target_to_sources = {}
    for src, tgt in zip(sources, targets):
        if tgt not in target_to_sources:
            target_to_sources[tgt] = []
        target_to_sources[tgt].append(src)

    active_nodes = set()
    conflicts = 0

    for tgt, src_list in target_to_sources.items():
        if len(src_list) == 1:
            active_nodes.add(src_list[0])
        else:
            # Need to pick the winner
            best_src = None
            max_queue = -float('inf')
            conflict_detected = False

            for src in src_list:
                queue = predictions[src]
                if queue > max_queue:
                    max_queue = queue
                    best_src = src
                    conflict_detected = False
                elif queue == max_queue:
                    # Ambiguity found among competing roads
                    conflict_detected = True

            if conflict_detected:
                conflicts += 1

            if best_src is not None:
              active_nodes.add(best_src)

    return list(active_nodes), conflicts

# --- 4. SYNTHETIC DATA & TRAINING LOOP ---
def main():
    print("Generating synthetic spatiotemporal dataset...")
    num_nodes = 10
    num_timesteps = 1000

    # Create oscillating traffic speeds
    data = np.sin(np.linspace(0, 50, num_timesteps))[:, None] * 30 + 50
    data = data + np.random.normal(0, 5, (num_timesteps, num_nodes))
    data = (data - data.mean(axis=0)) / data.std(axis=0)

    # Topologies to test
    topologies = {
        "Linear": np.array([list(range(num_nodes - 1)) + list(range(1, num_nodes)),
                            list(range(1, num_nodes)) + list(range(num_nodes - 1))], dtype=np.int32),
        "Intersection": np.array([
            [0, 1, 2, 3, 4, 4, 4, 4],
            [4, 4, 4, 4, 5, 6, 7, 8]
        ], dtype=np.int32),
        "Grid": np.array([
            [0, 1, 3, 4, 1, 2, 4, 5, 3, 4, 6, 7, 4, 5, 7, 8],
            [1, 0, 4, 3, 2, 1, 5, 4, 4, 3, 7, 6, 5, 4, 8, 7]
        ], dtype=np.int32)
    }

    def create_dataset(array, batch_size):
        seq_len, horizon = 12, 1
        X, Y = [], []
        for i in range(len(array) - seq_len - horizon):
            X.append(array[i: i + seq_len, :, np.newaxis])
            Y.append(array[i + seq_len + horizon - 1, :])
        return tf.data.Dataset.from_tensor_slices((np.array(X), np.array(Y))).batch(batch_size)

    param_space = {'learning_rate': [0.001, 0.005], 'lstm_units': [32, 64], 'batch_size': [32, 64]}
    
    for topo_name, edges in topologies.items():
        print(f"\n{'='*50}\nTraining on Topology: {topo_name}\n{'='*50}")
        agent = RLAgent(param_space)

        best_config = None
        best_loss = float('inf')

        print("Starting RL Hyperparameter Search...")
        for episode in range(4):
            action_idx = agent.select_action()
            config = agent.action_space[action_idx]

            print(f"Episode {episode + 1} | Testing: {config}")
            train_ds = create_dataset(data[:800], config['batch_size'])
            val_ds = create_dataset(data[800:], config['batch_size'])

            model = LSTMGC(in_feat=1, out_feat=16, lstm_units=config['lstm_units'], output_seq_len=1)
            model.compile(optimizer=tf.keras.optimizers.Adam(config['lr']), loss='mse')

            # Micro-training
            history = model.fit(train_ds.map(lambda x, y: ((x, edges), y)), epochs=2, verbose=0)
            loss = history.history['loss'][-1]

            # Calculate Conflict Penalty on Validation Set
            total_conflicts = 0
            for x_val, _ in val_ds:
                # Predict for the batch
                # Expand edges to have batch dimension 1 for a match (or just feed tuple)
                preds = model.predict((x_val, tf.repeat(tf.expand_dims(edges, 0), repeats=x_val.shape[0], axis=0)), verbose=0)
                # Preds shape: (batch, seq_len(1), num_nodes)
                
                for b in range(preds.shape[0]):
                    # Flatten the specific batch's node predictions
                    node_preds = preds[b, 0, :].flatten()
                    _, conflicts = get_green_lights(node_preds, edges)
                    total_conflicts += conflicts
            
            # Heavy penalty for identical queue predictions on competing incoming edges
            conflict_penalty = total_conflicts * 10.0

            reward = 1.0 / (loss + conflict_penalty + 1e-6)
            agent.update_q_table(action_idx, reward)

            print(f"  -> Loss: {loss:.4f} | Conflicts: {total_conflicts} | Penalty: {conflict_penalty:.1f} | Reward: {reward:.6f}")

            # Minimize both loss and conflicts
            overall_score = loss + conflict_penalty
            if overall_score < best_loss:
                best_loss = overall_score
                best_config = config

        print(f"\nOptimal Configuration Found for {topo_name}: {best_config}")
        print("Training Final Model...")

        final_model = LSTMGC(in_feat=1, out_feat=32, lstm_units=best_config['lstm_units'], output_seq_len=1)
        final_model.compile(optimizer=tf.keras.optimizers.Adam(best_config['lr']), loss='mse')

        train_ds = create_dataset(data, best_config['batch_size'])
        final_model.fit(train_ds.map(lambda x, y: ((x, edges), y)), epochs=5)

        # Save weights
        final_model.save_weights(f"traffic_model_{topo_name.lower()}.weights.h5")
        print(f"Model saved to traffic_model_{topo_name.lower()}.weights.h5")


if __name__ == "__main__":
    main()